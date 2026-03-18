class CharacterSummaryService:
    def __init__(self, plugin):
        self.plugin = plugin

    def generate_all_character_info_summary(
        self,
        user_hash: str,
        member_hashes: list,
        all_personas: dict,
        model: str,
    ) -> str:
        """
        Gửi một LLM request để tóm tắt persona của tất cả character trong group.
        Không bao gồm user persona (is_user: True hoặc không có persona field).
        Fallback: nếu LLM request thất bại, ghép nối trực tiếp các persona string.
        Không throw exception.
        """
        # Collect character personas (exclude user personas)
        char_entries = []
        for hash_ in member_hashes:
            persona = all_personas.get(hash_)
            if not persona:
                continue
            # Skip user personas
            if persona.get('is_user'):
                continue
            persona_text = persona.get('persona', '').strip()
            if not persona_text:
                continue
            name = persona.get('name', 'Unknown')
            char_entries.append((name, persona_text))

        if not char_entries:
            return ''

        # Try LLM summarization
        try:
            personas_block = '\n\n'.join(
                f"[{name}]\n{text}" for name, text in char_entries
            )
            prompt = (
                "Summarize the following character personas concisely. "
                "For each character, keep their name, key personality traits, and important background details. "
                "Be brief but informative.\n\n"
                f"{personas_block}"
            )

            response = self.plugin.core_api.ai_service.request(
                provider='ollama',
                operation='chat',
                payload={
                    'model': model,
                    'messages': [{'role': 'user', 'content': prompt}],
                    'timeout': 60,
                    'kwargs': {},
                },
                user_hash=user_hash,
            )

            text = ''
            if isinstance(response, dict) and 'choices' in response:
                text = response['choices'][0].get('message', {}).get('content', '')
            elif hasattr(response, 'choices') and response.choices:
                choice = response.choices[0]
                if isinstance(choice, dict):
                    text = choice.get('message', {}).get('content', '')
                else:
                    text = choice.message.content

            if text.strip():
                return text.strip()
        except Exception as e:
            print(f"[CharacterSummaryService] LLM request failed, using fallback: {e}")

        # Fallback: concatenate persona strings directly
        return '\n\n'.join(
            f"[{name}]\n{text}" for name, text in char_entries
        )

    def generate_per_character_summaries(
        self,
        user_hash: str,
        char_hashes: list,
        all_personas: dict,
        model: str,
    ) -> dict:
        """
        Tóm tắt persona từng character riêng lẻ bằng một LLM call mỗi character.
        Trả về { hash: summary_text }.
        Fallback về raw persona text nếu LLM thất bại.
        """
        results = {}
        for hash_ in char_hashes:
            persona = all_personas.get(hash_)
            if not persona:
                continue
            persona_text = persona.get('persona', '').strip()
            if not persona_text:
                results[hash_] = ''
                continue
            name = persona.get('name', 'Unknown')
            try:
                prompt = (
                    f"Summarize this character's persona in 1-2 concise sentences, "
                    f"capturing their name, key personality traits, and most important background details. "
                    f"Replace any second-person pronouns (you, your, yours, bạn, của bạn) that refer to the user "
                    f"with the placeholder {{{{user}}}} so the summary stays in third-person perspective.\n\n"
                    f"[{name}]\n{persona_text}"
                )
                response = self.plugin.core_api.ai_service.request(
                    provider='ollama',
                    operation='chat',
                    payload={
                        'model': model,
                        'messages': [{'role': 'user', 'content': prompt}],
                        'timeout': 30,
                        'kwargs': {},
                    },
                    user_hash=user_hash,
                )
                text = ''
                if isinstance(response, dict) and 'choices' in response:
                    text = response['choices'][0].get('message', {}).get('content', '')
                elif hasattr(response, 'choices') and response.choices:
                    choice = response.choices[0]
                    text = choice.message.content if hasattr(choice, 'message') else choice.get('message', {}).get('content', '')
                results[hash_] = text.strip() if text.strip() else persona_text[:200]
            except Exception as e:
                print(f"[CharacterSummaryService] Per-char summary failed for {hash_}: {e}")
                results[hash_] = persona_text[:200]
        return results
