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
    from_number = settings.TWILIO_SMS_FROM_NUMBER

    if not (sid and token and from_number):
        logger.warning(
            "Twilio not configured — skipping SMS to %s. "
            "Set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM_NUMBER in .env.",
            to_phone,
        )
        return

    message_body = (
        f"Hello Dr. {full_name},\n\n"
        f"Your login credentials for {hospital_name}:\n"
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
    Raises nothing — any Twilio error is logged and swallowed.
    """
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN
    from_number = settings.TWILIO_SMS_FROM_NUMBER

    if not (sid and token and from_number):
        logger.warning(
            "Twilio not configured — skipping SMS to %s.",
            to_phone,
        )
        return

    message_body = (
        f"Hello {full_name},\n\n"
        f"Your login credentials for {hospital_name} have been reset:\n"
        f"  Username : {username}\n"
        f"  Password : {password}\n\n"
        f"Please change your password after logging in.\n"
        f"— Admin Team"
    )

    try:
        from twilio.rest import Client

        client = Client(sid, token)
        client.messages.create(
            body=message_body,
            from_=from_number,
            to=to_phone,
        )
        logger.info("Password reset SMS sent to %s", to_phone)
    except Exception:
        logger.exception("Failed to send password reset SMS to %s", to_phone)


def send_patient_welcome(
    *,
    to_phone: str,
    patient_name: str,
    uhid: str,
    hospital_name: str = "our hospital",
) -> None:
    """
    Send a WhatsApp welcome message to a newly registered patient via Twilio
    Content API template.  Falls back to plain-body SMS if no WhatsApp from-number
    is configured.  Raises nothing — errors are logged and swallowed.
    """
    sid = settings.TWILIO_ACCOUNT_SID
    token = settings.TWILIO_AUTH_TOKEN

    if not (sid and token):
        logger.warning(
            "Twilio not configured — skipping welcome message to %s.", to_phone
        )
        return

    whatsapp_from = settings.TWILIO_WHATSAPP_FROM  # e.g. whatsapp:+14155238886

    # Normalise Indian phone numbers: raw 10-digit → +91XXXXXXXXXX
    def _normalise(phone: str) -> str:
        p = phone.strip().lstrip("+")
        if p.isdigit() and len(p) == 10:
            p = "91" + p
        return "+" + p

    normalised = _normalise(to_phone)
    to_wa = f"whatsapp:{normalised}"

    try:
        from twilio.rest import Client  # lazy import

        client = Client(sid, token)

        if whatsapp_from:
            # Plain WhatsApp text — no content_sid needed for welcome messages
            client.messages.create(
                from_=whatsapp_from,
                body=(
                    f"Welcome {patient_name},\n\n"
                    f"You have successfully registered with {hospital_name}.\n"
                    f"Your unique Health ID (UHID) is: {uhid}\n\n"
                    f"Please quote this UHID for all future visits.\n"
                    f"— {hospital_name}"
                ),
                to=to_wa,
            )
            logger.info("WhatsApp welcome sent to patient %s (%s)", uhid, normalised)
        else:
            # Fallback: plain SMS
            from_number = settings.TWILIO_SMS_FROM_NUMBER
            if not from_number:
                logger.warning("No from-number configured — skipping welcome to %s.", to_phone)
                return
            client.messages.create(
                body=(
                    f"Welcome {patient_name},\n"
                    f"You have successfully registered with {hospital_name}.\n"
                    f"Your UHID is: {uhid}\n"
                    f"— {hospital_name}"
                ),
                from_=from_number,
                to=normalised,
            )
            logger.info("SMS welcome sent to patient %s (%s)", uhid, normalised)
    except Exception:
        logger.exception("Failed to send welcome message to %s", to_phone)
