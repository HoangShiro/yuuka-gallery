import json
import hashlib

def compute_snapshot_id(prompt, config):
    """Tạo MD5 ID ngắn (12 ký tự) cực kỳ deterministic dựa trên Prompt và Settings cấu hình."""
    relevant_keys = [
        "ckpt_name", "sampler_name", "scheduler", "steps", "cfg", 
        "width", "height", "lora_name", "lora_strength_model", 
        "lora_strength_clip", "lora_chain", "denoise"
    ]
    
    standardized_prompt = str(prompt or "").strip().lower()
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
