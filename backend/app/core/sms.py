"""
SMS / WhatsApp notification helper using Twilio.

Sends credentials to a doctor after onboarding.
Gracefully no-ops when Twilio credentials are not configured (e.g. local dev
without .env values) so the rest of the onboard flow is never blocked.
"""
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def send_doctor_credentials(
    *,
    to_phone: str,
    full_name: str,
    username: str,
    password: str,
    hospital_name: str = "your hospital",
) -> None:
    """
    Send an SMS (or WhatsApp) message to a newly onboarded doctor with their
    login credentials.

    Raises nothing — any Twilio error is logged and swallowed so the HTTP
    response to the admin is never affected by notification failures.
    """
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN
    from_number = settings.TWILIO_FROM_NUMBER

    if not (sid and token and from_number):
        logger.warning(
            "Twilio not configured — skipping SMS to %s. "
            "Set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER in .env.",
            to_phone,
        )
        return

    message_body = (
        f"Hello Dr. {full_name},\n\n"
        f"Your login credentials for {hospital_name} HMS:\n"
        f"  Username : {username}\n"
        f"  Password : {password}\n\n"
        f"Please change your password after first login.\n"
        f"— Admin Team"
    )

    try:
        from twilio.rest import Client  # lazy import — avoids startup error if lib missing

        client = Client(sid, token)
        client.messages.create(
            body=message_body,
            from_=from_number,
            to=to_phone,
        )
        logger.info("Credentials SMS sent to %s", to_phone)
    except Exception:
        logger.exception("Failed to send credentials SMS to %s", to_phone)
