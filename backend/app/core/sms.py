"""
SMS / WhatsApp notification helper — Twilio provider.

Errors are always logged and swallowed — notification failures
must never block the main operation.
"""
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Twilio helpers ─────────────────────────────────────────────────────────────

def _twilio_send_sms(*, to: str, body: str) -> None:
    """Send a plain SMS via Twilio. Raises on any error — caller must catch."""
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN
    from_number = settings.TWILIO_SMS_FROM_NUMBER

    if not (sid and token and from_number):
        logger.warning("Twilio SMS not configured — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM_NUMBER.")
        return

    from twilio.rest import Client  # lazy import
    Client(sid, token).messages.create(body=body, from_=from_number, to=to)


def _twilio_send_whatsapp(*, to: str, body: str) -> None:
    """Send a WhatsApp message via Twilio. Falls back to SMS if no WhatsApp from-number. Raises on error."""
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN

    if not (sid and token):
        logger.warning("Twilio not configured — skipping WhatsApp to %s.", to)
        return

    whatsapp_from = settings.TWILIO_WHATSAPP_FROM
    from twilio.rest import Client  # lazy import
    client = Client(sid, token)

    if whatsapp_from:
        client.messages.create(from_=whatsapp_from, body=body, to=f"whatsapp:{to}")
    else:
        # Fallback: plain SMS
        _twilio_send_sms(to=to, body=body)


# ── Phone number normalisation ─────────────────────────────────────────────────

def _normalise_phone(phone: str) -> str:
    """Return E.164 form for an Indian 10-digit number; leave others intact."""
    p = phone.strip().lstrip("+")
    if p.isdigit() and len(p) == 10:
        p = "91" + p
    return "+" + p


# ── Public API ─────────────────────────────────────────────────────────────────

def send_doctor_credentials(
    *,
    to_phone: str,
    full_name: str,
    username: str,
    password: str,
    hospital_name: str = "your hospital",
) -> None:
    """
    Send an SMS to a newly onboarded doctor with their login credentials.
    Never raises — errors are logged and swallowed.
    """
    normalised = _normalise_phone(to_phone)
    body = (
        f"Hello Dr. {full_name},\n\n"
        f"Your login credentials for {hospital_name}:\n"
        f"  Username : {username}\n"
        f"  Password : {password}\n\n"
        f"Please change your password after first login.\n"
        f"— Admin Team"
    )
    try:
        _twilio_send_sms(to=normalised, body=body)
        logger.info("Credentials SMS sent to %s", normalised)
    except Exception:
        logger.exception("Failed to send credentials SMS to %s", normalised)


def send_staff_credentials(
    *,
    to_phone: str,
    full_name: str,
    username: str,
    password: str,
    hospital_name: str = "your hospital",
) -> None:
    """
    Send an SMS to a staff member with their (new) login credentials.
    Never raises — errors are logged and swallowed.
    """
    normalised = _normalise_phone(to_phone)
    body = (
        f"Hello {full_name},\n\n"
        f"Your login credentials for {hospital_name} have been reset:\n"
        f"  Username : {username}\n"
        f"  Password : {password}\n\n"
        f"Please change your password after logging in.\n"
        f"— Admin Team"
    )
    try:
        _twilio_send_sms(to=normalised, body=body)
        logger.info("Password reset SMS sent to %s", normalised)
    except Exception:
        logger.exception("Failed to send password reset SMS to %s", normalised)


def send_patient_welcome(
    *,
    to_phone: str,
    patient_name: str,
    uhid: str,
    hospital_name: str = "our hospital",
) -> None:
    """
    Send a welcome message to a newly registered patient via WhatsApp (Twilio).
    Never raises — errors are logged and swallowed.
    """
    normalised = _normalise_phone(to_phone)
    body = (
        f"Welcome {patient_name},\n\n"
        f"You have successfully registered with {hospital_name}.\n"
        f"Your unique Health ID (UHID) is: {uhid}\n\n"
        f"Please quote this UHID for all future visits.\n"
        f"— {hospital_name}"
    )
    try:
        _twilio_send_whatsapp(to=normalised, body=body)
        logger.info("Welcome message sent to patient %s (%s)", uhid, normalised)
    except Exception:
        logger.exception("Failed to send welcome message to %s", normalised)
