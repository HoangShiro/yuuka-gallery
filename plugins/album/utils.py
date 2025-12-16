import secrets
import uuid

def generate_short_tag_group_id(existing_ids=None, length=8):
    """Generate a short, collision-resistant id for user-owned tag groups."""
    existing_ids = existing_ids or set()
    for _ in range(50):
        # token_hex yields [0-9a-f] and is URL-safe
        candidate = secrets.token_hex(max(4, length // 2))[:length]
        if candidate and candidate not in existing_ids:
            return candidate
    # Extremely unlikely fallback
    return uuid.uuid4().hex[:length]

def safe_int(value, fallback):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback

def safe_float(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback

def normalize_lora_tags(tags):
    if isinstance(tags, list):
        return [str(tag).strip() for tag in tags if str(tag).strip()]
    if tags is None:
        return []
    text = str(tags).strip()
    return [text] if text else []
