import re
import threading
from typing import Any, Dict, List, Optional

class LLMService:
    PREFERENCES_ANALYSIS_INSTRUCTION = (
        "You are an expert AI analyzer specializing in Danbooru prompt engineering and user aesthetics. "
        "Your task is to analyze the user's prompt history to generate a concise, objective summary (1-2 paragraphs) "
        "of their style preferences, preferred characters/themes, and blacklisted/avoided concepts (things in negative prompts or missing from favorites). "
        "This summary will be used by another LLM to suggest customized prompts for this user. "
        "Write the summary in English, keep it professional, clear, and optimized for machine understanding."
    )

    def __init__(self, core_api, config_service, history_service, plugin=None):
        self.core_api = core_api
        self.config_service = config_service
        self.history_service = history_service
        self.plugin = plugin

    def trigger_user_preferences_analysis(self, user_hash: str):
        """Kích hoạt chạy phân tích sở thích người dùng ngầm trong một thread riêng."""
        thread = threading.Thread(
            target=self._run_preferences_analysis,
            args=(user_hash,),
            daemon=True
        )
        thread.start()

    def _run_preferences_analysis(self, user_hash: str):
        print(f"[LiveGen LLM] Bắt đầu phân tích ngầm sở thích cho user: {user_hash[:8]}")
        try:
            self.analyze_user_preferences(user_hash)
        except Exception as e:
            print(f"⚠️ [LiveGen LLM] Lỗi khi tự động phân tích sở thích người dùng: {e}")

    def analyze_user_preferences(self, user_hash: str) -> str:
        """Thực hiện phân tích sở thích của người dùng dựa trên lịch sử và lưu lại."""
        # 1. Thu thập tối đa 100 snapshot lịch sử
        history_images = self.history_service.get_history_images(user_hash) or []
        favorites_images = self.history_service.get_favorites_images(user_hash) or []
        
        prompts = []
        seen_prompts = set()
        
        # Gộp lại và ưu tiên thời gian gần nhất
        all_imgs = []
        for img in history_images:
            all_imgs.append((img, False))
        for img in favorites_images:
            all_imgs.append((img, True))
            
        all_imgs.sort(key=lambda x: x[0].get("createdAt", 0), reverse=True)
        recent_imgs = all_imgs[:100]
        
        for img, _ in recent_imgs:
            cfg = img.get("generationConfig") or {}
            prompt_text = (cfg.get("prompt") or "").strip()
            if prompt_text and prompt_text not in seen_prompts:
                seen_prompts.add(prompt_text)
                prompts.append(prompt_text)

        if not prompts:
            raise ValueError("Không tìm thấy lịch sử tạo ảnh hợp lệ để phân tích.")

        # 2. Xây dựng prompt
        prompts_list_text = "\n".join(f"- {p}" for p in prompts)
        user_prompt = (
            f"Here is the list of user's generated prompts (from recent and favorite images):\n"
            f"{prompts_list_text}\n\n"
            f"Please analyze these prompts and write the style, theme, and blacklist/avoidance summary."
        )

        # 3. Lấy cấu hình LLM hiện tại để thực hiện cuộc gọi
        cfg = self.config_service.get_config()
        provider = cfg.get("llm_provider", "gemini")
        model = cfg.get("llm_model", "gemini-2.5-flash")
        domain = cfg.get("llm_domain", "")
        api_key = cfg.get("llm_api_key", "")
        temp = cfg.get("llm_temperature", 0.7)
        disable_thinking = True

        overrides = {}
        if domain:
            overrides["base_url"] = domain

        system_prompt = self.PREFERENCES_ANALYSIS_INSTRUCTION
        if disable_thinking:
            system_prompt += "\nCRITICAL: Do NOT think. Do NOT output any <think> tags or reasoning. Start your response directly with the analysis summary."
            user_prompt += "\nREMINDER: Absolutely NO thinking process or <think> tags."

        max_tokens = 512 if disable_thinking else 1024
        kwargs = {
            "temperature": temp,
            "max_tokens": max_tokens
        }
        if disable_thinking:
            kwargs["extra_body"] = {
                "reasoning": "off",
                "reasoning_effort": "none"
            }

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        if disable_thinking and provider in ("lmstudio", "ollama"):
            messages.append({"role": "assistant", "content": "<think>\n</think>"})

        # 4. Thực hiện cuộc gọi LLM đồng bộ
        res = self.core_api.ai_service.request(
            provider=provider,
            operation="chat_completion",
            payload={
                "model": model,
                "messages": messages,
                "kwargs": kwargs
            },
            user_hash=user_hash,
            user_api_key=api_key if api_key else None,
            provider_overrides=overrides if overrides else None,
            timeout=45.0
        )

        summary_text = self._extract_text(res).strip()
        if summary_text:
            # 5. Lưu nhận xét vào file cá nhân hóa của user
            prefs = {"user_preferences": summary_text}
            self.core_api.data_manager.save_user_data(
                prefs, "live_gen_user_prefs.json", user_hash, obfuscated=True
            )
            print(f"[LiveGen LLM] Đã cập nhật sở thích cho user: {user_hash[:8]}")

            # 6. Phát WebSocket để cập nhật trực tiếp lên giao diện của user
            if self.plugin and hasattr(self.plugin, "session_manager"):
                self.plugin.session_manager.notify_user_preferences_updated(user_hash, summary_text)
            
            return summary_text
        else:
            raise ValueError("Phản hồi phân tích từ LLM trống.")

    def build_context_history(self, user_hash: str) -> Dict[str, Any]:
        """Tự động gom nhóm, chấm điểm, lọc ra 10 prompt mẫu và 100 tags có điểm cao nhất."""
        history_images = self.history_service.get_history_images(user_hash) or []
        favorites_images = self.history_service.get_favorites_images(user_hash) or []

        # Đánh dấu và gom nhóm
        items = []
        fav_ids = {img.get("original_image_id") or img.get("id") for img in favorites_images if img.get("id")}
        
        seen_ids = set()
        # Gom history
        for img in history_images:
            img_id = img.get("id")
            if img_id and img_id not in seen_ids:
                seen_ids.add(img_id)
                is_fav = img_id in fav_ids
                items.append((img, is_fav))
                
        # Gom favorites chưa có trong history
        for img in favorites_images:
            img_id = img.get("id")
            orig_id = img.get("original_image_id")
            key_id = orig_id or img_id
            if key_id and key_id not in seen_ids:
                seen_ids.add(key_id)
                items.append((img, True))

        # Sắp xếp theo thời gian mới nhất
        items.sort(key=lambda x: x[0].get("createdAt", 0), reverse=True)
        recent_items = items[:100]

        snapshot_scores = []
        tag_scores = {}

        # 1. Chấm điểm từng snapshot
        for idx, (img, is_fav) in enumerate(recent_items):
            cfg = img.get("generationConfig") or {}
            prompt = (cfg.get("prompt") or "").strip()
            if not prompt:
                continue

            weight = 2.0 if is_fav else 1.0
            recency = 1.0 - (idx / 100.0)
            score = weight * recency

            snapshot_scores.append({
                "prompt": prompt,
                "score": score
            })

            # Phân tích ra các tags đơn lẻ để chấm điểm
            tags = [t.strip().lower() for t in prompt.split(",") if t.strip()]
            for t in tags:
                if not t:
                    continue
                tag_scores[t] = tag_scores.get(t, 0.0) + score

        # 2. Lấy 10 snapshot prompt có score cao nhất (độc nhất)
        snapshot_scores.sort(key=lambda x: x["score"], reverse=True)
        unique_samples = []
        seen_prompts = set()
        for item in snapshot_scores:
            p = item["prompt"]
            if p not in seen_prompts:
                seen_prompts.add(p)
                unique_samples.append(p)
                if len(unique_samples) >= 10:
                    break

        # 3. Lấy 100 tags có score cao nhất
        sorted_tags = sorted(tag_scores.items(), key=lambda x: x[1], reverse=True)
        top_tags = [item[0] for item in sorted_tags[:100]]

        return {
            "prompt_samples": unique_samples,
            "frequently_used_tags": top_tags
        }

    def generate_prompt_completion(self, user_hash: str, current_prompt: str) -> str:
        """Thực hiện luồng Prompt Builder và gọi LLM gợi ý tags tối ưu hóa."""
        cfg = self.config_service.get_config()
        provider = cfg.get("llm_provider", "gemini")
        model = cfg.get("llm_model", "gemini-2.5-flash")
        domain = cfg.get("llm_domain", "")
        api_key = cfg.get("llm_api_key", "")
        temp = cfg.get("llm_temperature", 0.7)
        instruction = cfg.get("llm_instruction", "")

        # 1. Đọc User Preferences cá nhân hóa
        prefs_data = self.core_api.data_manager.load_user_data(
            "live_gen_user_prefs.json", user_hash, default_value={}, obfuscated=True
        )
        user_preferences = prefs_data.get("user_preferences", "").strip()
        disable_thinking = True

        # 2. Xây dựng ngữ cảnh history & tags
        ctx = self.build_context_history(user_hash)
        samples = ctx["prompt_samples"]
        freq_tags = ctx["frequently_used_tags"]

        # 3. Xây dựng System Prompt hoàn chỉnh
        system_prompt = f"{instruction}\n\n"
        
        if user_preferences:
            system_prompt += f"### User Preferences & Blacklist:\n{user_preferences}\n\n"

        if samples:
            samples_text = "\n".join(f"- {s}" for s in samples)
            system_prompt += f"### Highly-rated prompt samples from user history:\n{samples_text}\n\n"

        if freq_tags:
            system_prompt += f"### Frequently used tags by the user:\n{', '.join(freq_tags)}\n\n"

        if disable_thinking:
            system_prompt += "\nCRITICAL: Do NOT think. Do NOT write `<think>` or reasoning. Start your response directly with the comma and tags."

        # 4. Xây dựng User Prompt dựa trên input hiện tại
        current_prompt = (current_prompt or "").strip()
        
        # Kiểm tra xem người dùng có nhập nhân vật cụ thể không
        has_character = False
        all_chars = self.core_api.get_all_characters_list() or []
        for char in all_chars:
            char_name = char.get("name", "").lower()
            if char_name and char_name in current_prompt.lower():
                has_character = True
                break

        char_rule_reminder = ""
        if not has_character:
            char_rule_reminder = (
                "NOTE: The current input does not contain a specific anime character name. "
                "Keep the scene to a SINGLE character scene (e.g. '1girl, solo' or '1boy, solo') and expand on actions, expressions, and aesthetics. "
                "Do NOT add multiple characters."
            )

        if not current_prompt:
            user_prompt = (
                f"Suggest a complete anime image prompt (comma-separated Danbooru tags) based on the user's style preferences and context. "
                f"Ensure it focuses on a single character scene. "
                f"Return ONLY the tags, no other text."
            )
        else:
            user_prompt = (
                f"The user has typed the following tags:\n"
                f"'{current_prompt}'\n\n"
                f"Suggest additional high-quality tags to append to the existing prompt to make it beautifully detailed. "
                f"{char_rule_reminder}\n"
                f"Return ONLY the suggested new tags, starting with a comma (e.g., ', extremely detailed, dramatic lighting'). "
                f"Do NOT repeat any tags already present in the user's input, and do NOT include any other text."
            )

        if disable_thinking:
            user_prompt += "\nREMINDER: Return ONLY the raw tags starting with a comma. Absolutely NO thinking process or `<think>` tags."

        # 5. Gọi AI Service
        overrides = {}
        if domain:
            overrides["base_url"] = domain

        max_tokens = 256 if disable_thinking else 512
        kwargs = {
            "temperature": temp,
            "max_tokens": max_tokens
        }
        if disable_thinking:
            kwargs["extra_body"] = {
                "reasoning": "off",
                "reasoning_effort": "none"
            }

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        if disable_thinking and provider in ("lmstudio", "ollama"):
            messages.append({"role": "assistant", "content": "<think>\n</think>"})

        try:
            res = self.core_api.ai_service.request(
                provider=provider,
                operation="chat_completion",
                payload={
                    "model": model,
                    "messages": messages,
                    "kwargs": kwargs
                },
                user_hash=user_hash,
                user_api_key=api_key if api_key else None,
                provider_overrides=overrides if overrides else None,
                timeout=30.0
            )

            completion_text = self._extract_text(res).strip()
            
            # Làm sạch phản hồi để chỉ giữ lại tags dạng Booru
            cleaned_text = self._clean_llm_tags(completion_text, current_prompt)
            return cleaned_text
        except Exception as e:
            print(f"💥 [LiveGen LLM] Gợi ý prompt thất bại: {e}")
            return ""

    def _extract_text(self, res: Any) -> str:
        """Trích xuất chuỗi văn bản phản hồi an toàn từ kết quả trả về của AIService."""
        if not res:
            return ""
        if isinstance(res, str):
            return res
        if isinstance(res, dict):
            if "text" in res:
                return res["text"]
            if "choices" in res:
                try:
                    return res["choices"][0]["message"]["content"]
                except (KeyError, IndexError, TypeError):
                    pass
        if hasattr(res, "choices") and res.choices:
            try:
                return res.choices[0].message.content
            except (AttributeError, IndexError):
                pass
        return str(res)

    def _clean_llm_tags(self, text: str, current_prompt: str) -> str:
        """Lọc và làm sạch chuỗi tags để đảm bảo chuẩn Booru tags (không Markdown, không giải thích, không trùng lặp, không chứa Quality tags)."""
        # 1. Loại bỏ các đoạn bọc code ``` or ```html etc.
        text = re.sub(r"```[a-zA-Z0-9]*", "", text)
        text = text.replace("```", "").strip()
        
        # 2. Phân tách dòng và lọc bỏ các dòng chat đàm thoại hoặc markdown
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        valid_lines = []
        for line in lines:
            if line.startswith(("*", "-", "#")) or ":" in line or "here are" in line.lower() or "suggested tags" in line.lower():
                continue
            valid_lines.append(line)
            
        raw_tags_str = ", ".join(valid_lines) if valid_lines else text
        
        # 3. Phân tách thành các tags đơn lẻ để xử lý lọc nâng cao
        raw_tags = [t.strip() for t in raw_tags_str.split(",") if t.strip()]
        
        # Lấy cấu hình quality tags hiện tại để lọc bỏ
        cfg = self.config_service.get_config()
        quality_str = cfg.get("quality", "")
        quality_tags = {t.strip().lower() for t in quality_str.split(",") if t.strip()}
        
        # Lấy các tags hiện có trong prompt của user
        existing_tags = {t.strip().lower() for t in current_prompt.split(",") if t.strip()}
        
        filtered_suggested = []
        seen_suggested = set()
        
        for tag in raw_tags:
            tag_clean = re.sub(r"\s+", " ", tag).strip()
            tag_lower = tag_clean.lower()
            
            if not tag_lower:
                continue
            # Bỏ qua nếu là quality tag
            if tag_lower in quality_tags:
                continue
            # Bỏ qua nếu đã có trong prompt
            if tag_lower in existing_tags:
                continue
            # Bỏ qua nếu đã xuất hiện trong danh sách gợi ý này (de-duplicate)
            if tag_lower in seen_suggested:
                continue
                
            seen_suggested.add(tag_lower)
            filtered_suggested.append(tag_clean)
            
        # Giới hạn tối đa 25 tags gợi ý để giao diện hiển thị gọn gàng
        filtered_suggested = filtered_suggested[:25]
        
        if not filtered_suggested:
            return ""
            
        tags_str = ", ".join(filtered_suggested)
        
        # 4. Chuẩn hóa dấu phẩy ở đầu chuỗi gợi ý
        if current_prompt:
            tags_str = ", " + tags_str
            
        return tags_str
