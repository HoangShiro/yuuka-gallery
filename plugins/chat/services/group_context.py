import re


class GroupContextBuilder:
    def __init__(self, plugin):
        self.plugin = plugin

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_default_mode_context(
        self,
        user_hash: str,
        group_session: dict,
        main_char_hash: str,
        all_personas: dict,
        user_persona: dict,
        data: dict,
    ) -> tuple[str, list]:
        """
        Build context cho Default Mode (một character phản hồi).
        Trả về (system_prompt, messages_list).
        """
        # Cache personas for use in flatten helpers
        self._cached_personas = all_personas
        user_name = user_persona.get('name', 'User') if user_persona else 'User'
        self._cached_user_name = user_name
        parts = []

        # 1. chat_group_system rule
        group_system_rule = self.plugin.get_rule_content(user_hash, 'chat_group_system')
        if group_system_rule:
            main_persona_tmp = all_personas.get(main_char_hash, {})
            char_name_tmp = main_persona_tmp.get('name', '')
            rule_text = group_system_rule.replace('{{char}}', char_name_tmp).replace('{{user}}', user_name)
            parts.append(rule_text)

        # 1b. chat_format rule (system_update schema instructions)
        # Inject other member names so the rule can show a realistic "mentioned" example
        other_member_names = []
        for h in group_session.get('member_hashes', []):
            if h != main_char_hash:
                p = all_personas.get(h, {})
                if p.get('name'):
                    other_member_names.append(p['name'])
        data = dict(data)
        data['other_member_names'] = other_member_names
        chat_format_rule = self.plugin.get_formatted_chat_rule(user_hash, data)
        if chat_format_rule:
            parts.append(chat_format_rule)

        # 1c. First message rule (injected when no prior messages)
        if group_session.get('is_first_message'):
            first_msg_rule = self.plugin.get_rule_content(user_hash, 'chat_group_first_message')
            if first_msg_rule:
                parts.append(first_msg_rule)

        # 1d. Continue rule — check if last history message is from the same character
        # (rule will be appended AFTER chat history as a user message, not here)
        _continue_same_char = False
        if group_session.get('is_continue'):
            messages_list = group_session.get('messages', [])
            last_char_hash = None
            for m in reversed(messages_list):
                if m.get('role') == 'assistant' and _get_message_content(m):
                    last_char_hash = m.get('character_hash')
                    break
            if last_char_hash and last_char_hash == main_char_hash:
                _continue_same_char = True
        group_session['_continue_same_char'] = _continue_same_char

        # 2. Main character persona
        main_persona = all_personas.get(main_char_hash, {})
        char_name = main_persona.get('name', '') if main_persona else ''
        if main_persona:
            parts.append(_format_character_persona(main_persona, char_name=char_name, user_name=user_name))

        # 3. Scene content (nếu có scene_ids trong group_session)
        scene_content = self._get_scene_content(user_hash, group_session)
        if scene_content:
            parts.append(scene_content)

        # 4. Group description
        description = group_session.get('description', '').strip()
        if description:
            parts.append(f"<group_description>\n{description}\n</group_description>")

        # 5. Memory summary (nếu có)
        memory_summary = group_session.get('memory_summary', '').strip()
        if memory_summary:
            parts.append(f"<memory_summary>\n{memory_summary}\n</memory_summary>")

        # 6. User persona
        if user_persona:
            user_name = user_persona.get('name', 'User')
            user_persona_text = user_persona.get('persona', '').strip()
            if user_persona_text:
                parts.append(f"<user_persona name=\"{user_name}\">\n{user_persona_text}\n</user_persona>")

        # 7. All character info summary (other characters)
        # Fallback: nếu summary chưa có, ghép trực tiếp persona của các other members
        all_char_summary = group_session.get('all_character_info_summary', '').strip()
        if all_char_summary:
            # Filter out main character's block from the combined summary
            # Format: "[Name]\nsummary\n\n[Name2]\nsummary2"
            main_char_name = (all_personas.get(main_char_hash) or {}).get('name', '')
            all_char_summary = _filter_out_char_block(all_char_summary, main_char_name)
            # Replace {{user}} and per-block {{char}} in stored summary text
            all_char_summary = _replace_placeholders_in_summary(all_char_summary, user_name)
        if not all_char_summary:
            member_hashes = group_session.get('member_hashes', [])
            other_hashes = [h for h in member_hashes if h != main_char_hash]
            fallback_parts = []
            for h in other_hashes:
                p = all_personas.get(h, {})
                if p:
                    other_name = p.get('name', '')
                    fallback_parts.append(_format_character_persona(p, char_name=other_name, user_name=user_name))
            all_char_summary = '\n\n'.join(fallback_parts)
        if all_char_summary:
            parts.append(f"<other_characters_summary>\n{all_char_summary}\n</other_characters_summary>")

        # 8. Current state (location, outfits, inventory) — per-character from character_states
        char_state = (group_session.get('character_states') or {}).get(main_char_hash, {})
        location = char_state.get('location') or group_session.get('location', '') or 'Unknown'
        outfits = char_state.get('outfits') or group_session.get('outfits', []) or []
        inventory = char_state.get('inventory') or group_session.get('inventory', []) or []
        parts.append(_format_current_state_from_values(location, outfits, inventory))

        system_prompt = "\n\n".join(p for p in parts if p)

        # Messages: flatten history với mode="default"
        messages = group_session.get('messages', [])
        flat_messages = self.flatten_group_messages(
            messages, main_char_hash, mode="default",
            continue_same_char=group_session.get('_continue_same_char', False)
        )

        # Append continue rule as final user message (after history) for stronger effect
        if group_session.get('is_continue') and group_session.get('_continue_same_char'):
            continue_rule = self.plugin.get_rule_content(user_hash, 'chat_continue')
            if continue_rule:
                char_name_tmp = (all_personas.get(main_char_hash) or {}).get('name', '')
                rule_text = continue_rule.replace('{{char}}', char_name_tmp).replace('{{user}}', user_name)
                flat_messages.append({'role': 'user', 'content': rule_text})

        # Inject seed message when there are no history messages so the LLM has something to respond to
        if not flat_messages:
            flat_messages.append({'role': 'user', 'content': '[Start of conversation]'})

        return system_prompt, flat_messages


    def flatten_group_messages(
        self,
        messages: list,
        main_char_hash: str | None,
        mode: str = "default",
        continue_same_char: bool = False,
    ) -> list:
        return self._flatten_default_mode(messages, main_char_hash, continue_same_char=continue_same_char)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _flatten_default_mode(self, messages: list, main_char_hash: str | None, continue_same_char: bool = False) -> list:
        # Pre-pass: find the index of the last message for each character_hash
        # so we know which messages need <system_update> preserved/injected
        last_idx_per_char: dict[str, int] = {}
        for i, msg in enumerate(messages):
            if msg.get('role') == 'assistant':
                ch = msg.get('character_hash') or '__main__'
                content = _get_message_content(msg)
                if content:
                    last_idx_per_char[ch] = i

        # When continue_same_char=True, find the last message index from main_char_hash
        last_main_char_idx = -1
        if continue_same_char and main_char_hash:
            last_main_char_idx = last_idx_per_char.get(main_char_hash, -1)

        result = []
        for i, msg in enumerate(messages):
            role = msg.get('role', '')

            # Skip system messages entirely — action context is now in snapshot[3]
            if role == 'system':
                continue

            content = _get_message_content(msg)
            if not content:
                continue

            if role == 'user':
                user_name = getattr(self, '_cached_user_name', 'User')
                # Read action_context from snapshot[3] (new format)
                snap = _get_active_snapshot(msg)
                action_context = snap[3] if snap and len(snap) > 3 else None
                # Compat: fall back to linked_actions field
                if not action_context:
                    action_context = msg.get('linked_actions') or []
                if action_context:
                    labels = ', '.join(a.get('label', '') for a in action_context if a.get('label'))
                    if labels:
                        content = f'{content}\n{labels}' if content else labels
                result.append({'role': 'user', 'content': f'[{user_name}]: {content}'})
            elif role == 'assistant':
                char_hash = msg.get('character_hash')
                char_key = char_hash or '__main__'
                is_last_for_char = (last_idx_per_char.get(char_key) == i)

                if char_hash and char_hash != main_char_hash:
                    # Other character → treat as user turn, prefix with name
                    cached = getattr(self, '_cached_personas', None) or {}
                    other_persona = cached.get(char_hash, {})
                    char_name = other_persona.get('name', '') or char_hash
                    final_content = _ensure_system_update(content) if is_last_for_char else content
                    result.append({'role': 'user', 'content': f'[{char_name}]: {final_content}'})
                else:
                    # Main character message
                    if continue_same_char and i == last_main_char_idx:
                        final_content = _ensure_system_update(content)
                        result.append({'role': 'assistant', 'content': final_content})
                    else:
                        final_content = _ensure_system_update(content) if is_last_for_char else content
                        result.append({'role': 'assistant', 'content': final_content})

        return result


    def _get_scene_content(self, user_hash: str, group_session: dict) -> str:
        """Load và ghép nội dung các scene được gắn vào session."""
        scene_ids = group_session.get('scenes', [])
        if not scene_ids:
            return ''

        scene_parts = []
        for scene_id in scene_ids:
            try:
                scene = self.plugin.get_scene_by_id(user_hash, scene_id)
                if scene:
                    scene_content = scene.get('content', '').strip()
                    if scene_content:
                        scene_name = scene.get('name', '')
                        if scene_name:
                            scene_parts.append(f"[{scene_name}]\n{scene_content}")
                        else:
                            scene_parts.append(scene_content)
            except Exception:
                pass

        if not scene_parts:
            return ''

        combined = "\n\n".join(scene_parts)
        return f"<scene>\n{combined}\n</scene>"


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------

def _format_character_persona(persona: dict, char_name: str = '', user_name: str = 'User') -> str:
    """Format một character persona dict thành XML tag, replace {{char}} và {{user}}."""
    name = persona.get('name', 'Character')
    persona_text = persona.get('persona', '').strip()
    appearance = persona.get('appearance', [])

    if not persona_text and not appearance:
        return ''

    # Use provided char_name or fall back to persona name
    resolved_char = char_name or name
    resolved_user = user_name or 'User'

    if persona_text:
        persona_text = persona_text.replace('{{char}}', resolved_char).replace('{{user}}', resolved_user)

    appearance_tag = ''
    if appearance:
        if isinstance(appearance, list):
            appearance_tag = f"\n<appearance>{', '.join(appearance)}</appearance>"
        else:
            appearance_tag = f"\n<appearance>{appearance}</appearance>"

    return f"<character_persona name=\"{name}\">\n{persona_text}{appearance_tag}\n</character_persona>"


def _filter_out_char_block(summary: str, char_name: str) -> str:
    """
    Loại bỏ block của một character khỏi combined summary.
    Format: "[Name]\nsummary\n\n[Name2]\nsummary2"
    """
    if not char_name or not summary:
        return summary
    blocks = summary.split('\n\n')
    filtered = [b for b in blocks if not b.strip().startswith(f'[{char_name}]')]
    return '\n\n'.join(filtered).strip()


def _replace_placeholders_in_summary(summary: str, user_name: str) -> str:
    """
    Replace {{user}} với user_name trong toàn bộ summary.
    Replace {{char}} với tên character tương ứng trong từng block "[Name]\n...".
    """
    if not summary:
        return summary

    # Replace {{user}} globally
    result = summary.replace('{{user}}', user_name)

    # Replace {{char}} per-block using the [Name] header of each block
    blocks = result.split('\n\n')
    processed = []
    for block in blocks:
        stripped = block.strip()
        m = re.match(r'^\[([^\]]+)\]', stripped)
        if m:
            block_char_name = m.group(1)
            block = block.replace('{{char}}', block_char_name)
        processed.append(block)
    return '\n\n'.join(processed)


def _format_current_state(group_session: dict) -> str:
    """Format current state (location, outfits, inventory) từ group session."""
    location = group_session.get('location', '') or 'Unknown'
    outfits = group_session.get('outfits', []) or []
    inventory = group_session.get('inventory', []) or []
    return _format_current_state_from_values(location, outfits, inventory)


def _format_current_state_from_values(location: str, outfits: list, inventory: list) -> str:
    """Format current state block từ các giá trị cụ thể."""
    outfits_str = ', '.join(outfits) if outfits else 'None'
    inventory_str = ', '.join(inventory) if inventory else 'Empty'

    return (
        "<current_state>\n"
        f"Current Location: {location}\n"
        f"Currently Worn Outfits: {outfits_str}\n"
        f"Inventory/Bag: {inventory_str}\n"
        "</current_state>"
    )


def _get_message_content(msg: dict) -> str:
    """Lấy nội dung text của một message, hỗ trợ snapshots dạng [text, images]."""
    snapshots = msg.get('snapshots')
    if snapshots:
        active_index = msg.get('activeIndex', 0)
        try:
            snap = snapshots[active_index]
        except (IndexError, TypeError):
            snap = snapshots[0] if snapshots else None
        if snap is None:
            return ''
        # Snapshot format: [text, images_array, status, action_context] or plain string (legacy)
        if isinstance(snap, list):
            return snap[0] if snap else ''
        return snap or ''
    return msg.get('content', '') or ''


def _get_active_snapshot(msg: dict) -> list | None:
    """Lấy active snapshot array của một message. Trả về list hoặc None."""
    snapshots = msg.get('snapshots')
    if not snapshots:
        return None
    active_index = msg.get('activeIndex', 0)
    try:
        snap = snapshots[active_index]
    except (IndexError, TypeError):
        snap = snapshots[0] if snapshots else None
    if isinstance(snap, list):
        return snap
    return None


def _ensure_system_update(content: str) -> str:
    """
    Đảm bảo content có <system_update> block.
    Nếu thiếu, thêm một thẻ giả với các field null/false để LLM học format.
    """
    if '<system_update>' in content:
        return content
    placeholder = (
        '<system_update>{"location": null, "put_on": null, "take_off": null, '
        '"mentioned": [], "emotion": null, "action": null, "time_skip": false}</system_update>'
    )
    return content.rstrip() + '\n' + placeholder
