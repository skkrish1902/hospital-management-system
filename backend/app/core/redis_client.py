"""
Redis client singleton for the backend.
Used for:
  - Refresh token JTI blocklist (logout / suspend)
  - Tenant feature cache (live enforcement, TTL 5 min)
  - WebSocket pub/sub (see websocket/redis_bridge.py)

Intentionally lightweight — one module-level client reused across requests.
"""
import json
import uuid

import redis.asyncio as aioredis

from app.core.config import settings

# Key prefix for the token blocklist in Redis
_BLOCKLIST_PREFIX = "blocklist:jti:"

# Key prefix for tenant feature sets — value is a JSON list of enabled feature keys.
# TTL is intentionally short: super_admin toggling a feature takes effect within 5 min
# even for users who already have a live JWT.
_FEATURE_PREFIX = "tenant:features:"
_FEATURE_TTL = 300  # 5 minutes

# Module-level singleton (lazily initialized; safe for asyncio)
_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


async def block_token(jti: str, ttl_seconds: int) -> None:
    """Add a refresh token JTI to the blocklist with an expiry matching the token's remaining lifetime."""
    redis = get_redis()
    await redis.setex(f"{_BLOCKLIST_PREFIX}{jti}", ttl_seconds, "1")


async def is_token_blocked(jti: str) -> bool:
    """Return True if this token JTI has been revoked (logged out or tenant suspended)."""
    redis = get_redis()
    return await redis.exists(f"{_BLOCKLIST_PREFIX}{jti}") > 0


# ── Tenant feature cache ───────────────────────────────────────────────────────

def _feature_key(tenant_id: uuid.UUID | str) -> str:
    return f"{_FEATURE_PREFIX}{tenant_id}"


async def get_cached_features(tenant_id: uuid.UUID | str) -> list[str] | None:
    """
    Return the cached list of enabled feature keys for a tenant, or None if the
    cache entry has expired / doesn't exist yet.
    """
    redis = get_redis()
    raw = await redis.get(_feature_key(tenant_id))
    if raw is None:
        return None
    return json.loads(raw)


async def set_cached_features(tenant_id: uuid.UUID | str, enabled_features: list[str]) -> None:
    """Write (or refresh) the feature cache for a tenant with a 5-minute TTL."""
    redis = get_redis()
    await redis.setex(_feature_key(tenant_id), _FEATURE_TTL, json.dumps(enabled_features))


async def invalidate_feature_cache(tenant_id: uuid.UUID | str) -> None:
    """
    Immediately remove the feature cache for a tenant.
    Called by super_admin whenever features are toggled — the next request for
    this tenant will re-read from the DB and repopulate the cache.
    """
    redis = get_redis()
    await redis.delete(_feature_key(tenant_id))
