import json
import hashlib
import re

def normalize_prompt(raw_prompt):
    if not raw_prompt:
        return ""
    # Replace newlines with comma and space
    normalized = re.sub(r'[\r\n]+', ', ', raw_prompt)
    # Replace multiple commas like ", ," with a single comma
    normalized = re.sub(r',\s*,', ',', normalized)
    # Normalize spaces around commas
    normalized = re.sub(r'\s*,\s*', ', ', normalized)
    # Trim leading/trailing spaces and commas
    return normalized.strip().strip(',').strip()

def compute_snapshot_id(prompt, config):
    """Tạo MD5 ID ngắn (12 ký tự) cực kỳ deterministic dựa trên Prompt và Settings cấu hình."""
    relevant_keys = [
        "ckpt_name", "sampler_name", "scheduler", "steps", "cfg", 
        "width", "height", "lora_name", "lora_strength_model", 
        "lora_strength_clip", "lora_chain", "denoise"
    ]
    
    normalized_prompt = normalize_prompt(prompt)
    standardized_prompt = str(normalized_prompt).strip().lower()
    seed = config.get("seed")
    try:
        seed = int(seed) if seed is not None else 0
    except (ValueError, TypeError):
        seed = 0
        
    normalized = {
        "prompt": standardized_prompt,
        "seed": seed
    }
    for key in relevant_keys:
        if key in config:
            val = config[key]
            if isinstance(val, str):
                val = val.strip().lower()
            elif isinstance(val, bool):
                val = str(val).lower()
            normalized[key] = val
            
    serialized = json.dumps(normalized, sort_keys=True)
    return hashlib.md5(serialized.encode('utf-8')).hexdigest()[:12]
