import time
import uuid

# Default system instructions that ship with the plugin
DEFAULT_RULES = {
    "world_builder": {
        "id": "world_builder",
        "name": "World builder",
        "is_default": True,
        "content": (
            "You are a world-building assistant. Your task is to write a vivid, immersive scene description "
            "that establishes the setting, atmosphere, and environment.\n\n"
            "Guidelines:\n"
            "- Describe the location in rich sensory detail (sights, sounds, smells, textures, lighting).\n"
            "- Establish the time of day, weather, and overall mood/atmosphere.\n"
            "- Include environmental details that hint at the world's history or culture.\n"
            "- If character information is provided, weave in details that connect the setting to the characters "
            "(e.g. their home, a place they frequent, objects that belong to them).\n"
            "- Keep the tone consistent with the genre and context provided.\n"
            "- Do NOT write dialogue or narrate character actions.\n"
            "- Write in third-person present tense.\n"
            "- Output ONLY the scene description, no preambles or meta-commentary."
        )
    },
    "first_message": {
        "id": "first_message",
        "name": "First message",
        "is_default": True,
        "content": (
            "You are a narrator opening a roleplay scene. Your task is to write a compelling first message "
            "that introduces the character and sets up the initial encounter with the user.\n\n"
            "Guidelines:\n"
            "- Establish the scene/setting briefly (location, time, atmosphere).\n"
            "- Describe the character's appearance, current activity, and emotional state.\n"
            "- Include the character's first dialogue line or inner thoughts, staying true to their persona.\n"
            "- Create a natural opening for the user to respond to.\n"
            "- Do NOT write dialogue or actions for the user — only describe the character.\n"
            "- Do NOT break the fourth wall or acknowledge this is a roleplay.\n"
            "- Use a narrative style with *italics for actions/descriptions* and regular text for speech.\n"
            "- Keep it very concise — 1-2 short paragraphs maximum.\n"
            "- If scene information is provided, use it as the setting context.\n"
            "- Output ONLY the narrative, no preambles or meta-commentary."
        )
    },
    "event": {
        "id": "event",
        "name": "Event",
        "is_default": True,
        "content": (
            "You are a narrator injecting a random event into an ongoing roleplay scene. "
            "Your task is to write a brief, engaging narrative event that adds excitement or a twist.\n\n"
            "Guidelines:\n"
            "- The event should feel organic to the current context (location, time, ongoing situation).\n"
            "- It can be environmental (weather change, unexpected visitor), social (someone approaches), "
            "comedic, dramatic, or mysterious — choose what fits the mood.\n"
            "- Describe how the event affects the scene or the character.\n"
            "- The character may react to the event — stay true to their persona.\n"
            "- Do NOT write dialogue or actions for the user.\n"
            "- Keep it brief — 1-3 paragraphs.\n"
            "- Use a narrative style with *italics for actions/descriptions* and regular text for speech.\n"
            "- Output ONLY the narrative, no preambles or meta-commentary."
        )
    },
    "chat_system": {
        "id": "chat_system",
        "name": "Chat System",
        "is_default": True,
        "content": (
            "CRITICAL INSTRUCTION: You MUST strictly adhere to the <character_persona>. "
            "NEVER break character. NEVER acknowledge you are an AI. "
            "Use a narrative style where speech is regular text and actions/physical descriptions are enclosed in asterisks (e.g., *smiles at you*). "
            "Keep responses conversational, concise, and proportional to the {{user}}'s message length unless asked for detail."
        )
    },
    "chat_continue": {
        "id": "chat_continue",
        "name": "Chat Continue",
        "is_default": True,
        "content": (
            "CONTINUE INSTRUCTION: There is no new user message. {{char}} should continue naturally on their own.\n"
            "- Stay fully in character as {{char}}. Do NOT break character or acknowledge you are an AI.\n"
            "- Use a narrative style: regular text for speech, *italics for actions*.\n"
            "- Continue from where the conversation left off — add a new action, thought, dialogue, or reaction.\n"
            "- Do NOT repeat or paraphrase what was already said. Move the scene forward.\n"
            "- Keep the response proportional and natural — do not over-explain or monologue unless it fits {{char}}'s persona.\n"
            "- Do NOT address the absence of a user message. Simply continue as {{char}} would."
        )
    },
    "chat_group_system": {
        "id": "chat_group_system",
        "name": "Chat Group System",
        "is_default": True,
        "content": (
            "CRITICAL INSTRUCTION: You are {{char}} in a group conversation.\n"
            "NEVER break character. NEVER acknowledge you are an AI.\n"
            "Use a narrative style: regular text for speech, *italics for actions*.\n"
            "Other characters may appear in the conversation history — respond ONLY as {{char}}.\n"
            "Keep responses conversational and proportional to the message length.\n"
            "At the END of EVERY message, append a <system_update> block as instructed."
        )
    },
    "chat_discord_system": {
        "id": "chat_discord_system",
        "name": "Chat Discord System",
        "is_default": True,
        "content": (
            "CRITICAL INSTRUCTION: You are {{char}} chatting inside a Discord server.\n"
            "NEVER break character. NEVER acknowledge you are an AI.\n"
            "Discord server, channel, and participant details may appear in the context — respond ONLY as {{char}}.\n"
            "Keep the reply short, conversational, and proportional to the latest message unless detail is requested.\n"
            "Return EXACTLY one HTML block for the message and ONE OR MORE <call_command> tags using this format:\n"
            "<discord-reply><message language=\"{{primary_language}}\">Primary language reply here.</message><message language=\"{{secondary_language}}\">Secondary language reply here.</message></discord-reply>\n"
            "<call_command>{\"tool_id\": \"command_name_1\", \"payload\": {\"arg1\": \"value\"}}</call_command>\n"
            "<call_command>{\"tool_id\": \"command_name_2\", \"payload\": {\"arg1\": \"value\"}}</call_command>\n"
            "Rules:\n"
            "- The first <message> MUST contain the full in-character reply in {{primary_language}}.\n"
            "- The second <message> MUST contain the same reply, naturally localized into {{secondary_language}}.\n"
            "- Prefer 1-3 short sentences total unless the user explicitly asks for more detail.\n"
            "- You CAN execute multiple commands by adding multiple <call_command> blocks.\n"
            "- You MUST always return at least one <call_command> tag appended at the very end.\n"
            "- If you do not wish to call any command, use <call_command>Null</call_command>.\n"
            "- Every <call_command> MUST be a valid JSON object with \"tool_id\" and \"payload\" fields as shown in the tools list.\n"
            "- Do NOT append <system_update> or any other metadata tags.\n"
            "- Do NOT include any text before or after."
        )
    },
    "chat_format": {
        "id": "chat_format",
        "name": "Chat Format",
        "is_default": True,
        "content": (
            "<instructions>\n"
            "At the END of EVERY message, you MUST append a <system_update> block. No exceptions.\n"
            "Format: <system_update>{{...JSON...}}</system_update>\n\n"
            "The JSON MUST include ALL of the following fields every time:\n"
            "  - \"location\": string | null — current scene/place, or null if unchanged\n"
            "  - \"put_on\": [\"item\", ...] | null — outfit items being worn, or null if none\n"
            "  - \"take_off\": [\"item\", ...] | null — outfit items being removed, or null if none\n"
            "{{emotion_types_info}}\n"
            "{{action_types_info}}\n"
            "  - \"mentioned\": [\"Name\", ...] — names of OTHER characters you directly address, call out, or refer to by name in your response. Use [] if none.{{mentioned_names_hint}}\n"
            "  - \"time_skip\": true | false — true ONLY on narrative time jumps (e.g. \"next morning\", \"hours later\"). false otherwise.\n\n"
            "Rules:\n"
            "  - ALL fields are required in every response. Use null for non-bool fields with no change.\n"
            "  - Do NOT omit any field.\n\n"
            "Example: <system_update>{{example_json}}</system_update>\n"
            "{{capabilities_info}}\n"
            "</instructions>"
        )
    },
    "chat_group_first_message": {
        "id": "chat_group_first_message",
        "name": "Chat Group First Message",
        "is_default": True,
        "content": (
            "FIRST MESSAGE INSTRUCTION: This is the very beginning of the group roleplay — there are no prior messages.\n"
            "Write an engaging opening message as your character that:\n"
            "- Establishes the scene and your character's current activity or mood.\n"
            "- Use a narrative style: regular text for speech, *italics for actions*.\n"
            "- Naturally acknowledges the presence of the other characters in the group.\n"
            "- Creates an inviting opening for the conversation to begin.\n"
            "- Stays fully in character. Do NOT break character or acknowledge you are an AI.\n"
            "- Keep it concise — 1-3 sentences of dialogue or action.\n"
            "- Remember to append the <system_update> block at the end as instructed.\n"
            "IMPORTANT: You MUST write actual dialogue or action text BEFORE the <system_update> block. Do NOT output only the <system_update> block."
        )
    },
    "group_event": {
        "id": "group_event",
        "name": "Group Event",
        "is_default": True,
        "content": (
            "You are a narrator injecting a random event into an ongoing GROUP roleplay scene.\n"
            "The group contains multiple characters. Your event should feel organic and can involve:\n"
            "  - One or more of the existing group members (a reaction, a surprise, a conflict, a funny moment)\n"
            "  - OR the arrival of a NEW character from the candidate list (if the group is not full)\n\n"
            "Guidelines:\n"
            "- The event should feel natural given the current location, mood, and conversation context.\n"
            "- If introducing a new character, describe their entrance vividly and hint at their personality.\n"
            "- Keep it brief — 1-3 paragraphs. Use *italics for actions* and regular text for speech.\n"
            "- Do NOT write actions for the user.\n"
            "- Output the narrative text first.\n"
            "- If and ONLY IF you are introducing a new character, append at the very end:\n"
            "  <group_action>{\"type\": \"new_character\", \"character_hash\": \"<hash>\", \"character_summary\": \"<flat text summary of the character's personality, appearance, and key traits in 2-3 sentences>\"}</group_action>\n"
            "  where <hash> is the exact hash from the candidate list, and character_summary is a concise plain-text description.\n"
            "- If no new character is introduced, do NOT include any <group_action> tag.\n"
            "- Output ONLY the narrative (and optional group_action tag). No preambles or meta-commentary."
        )
    }
}


class ChatScenarioMixin:
    """Mixin providing CRUD operations for Scenario data (Scenes + System Instructions/Rules)."""

    def _get_scenarios_filename(self):
        return getattr(self, 'CHAT_SCENARIOS_FILENAME', 'chat_scenarios.json')

    def get_all_scenarios(self, user_hash):
        filename = self._get_scenarios_filename()
        data = self.core_api.data_manager.load_user_data(
            filename,
            user_hash,
            default_value={"scenes": {}, "rules": {}},
            obfuscated=True
        )
        # Ensure default rules exist and content is up-to-date
        rules = data.get("rules", {})
        changed = False
        for key, default_rule in DEFAULT_RULES.items():
            if key not in rules:
                rules[key] = {
                    **default_rule,
                    "created_at": time.time(),
                    "updated_at": time.time()
                }
                changed = True
            else:
                # Always sync content of default rules to latest version
                if rules[key].get("content") != default_rule["content"]:
                    rules[key]["content"] = default_rule["content"]
                    rules[key]["updated_at"] = time.time()
                    changed = True
        data["rules"] = rules
        if changed:
            self.core_api.data_manager.save_user_data(
                data, filename, user_hash, obfuscated=True
            )
        return data

    def save_scene(self, user_hash, scene_data, scene_id=None):
        filename = self._get_scenarios_filename()
        data = self.get_all_scenarios(user_hash)

        if not scene_id:
            scene_id = str(uuid.uuid4())
            scene_data["id"] = scene_id
            scene_data["created_at"] = time.time()
        else:
            scene_data["id"] = scene_id

        scene_data["updated_at"] = time.time()
        data["scenes"][scene_id] = scene_data

        self.core_api.data_manager.save_user_data(
            data, filename, user_hash, obfuscated=True
        )
        return scene_data

    def delete_scene(self, user_hash, scene_id):
        filename = self._get_scenarios_filename()
        data = self.get_all_scenarios(user_hash)
        if scene_id in data.get("scenes", {}):
            del data["scenes"][scene_id]
            self.core_api.data_manager.save_user_data(
                data, filename, user_hash, obfuscated=True
            )
            return True
        return False

    def save_rule(self, user_hash, rule_data, rule_id=None):
        filename = self._get_scenarios_filename()
        data = self.get_all_scenarios(user_hash)

        if not rule_id:
            rule_id = str(uuid.uuid4())
            rule_data["id"] = rule_id
            rule_data["created_at"] = time.time()
        else:
            rule_data["id"] = rule_id
            # Default rules are read-only — ignore any edits, return current data as-is
            if rule_id in DEFAULT_RULES:
                return data.get("rules", {}).get(rule_id, {})

        # Enforce mutual exclusivity for apply_to: clear any other non-default rule
        # that previously claimed the same apply_to target
        new_apply_to = rule_data.get("apply_to")
        if new_apply_to and not rule_data.get("is_default"):
            for rid, rule in data.get("rules", {}).items():
                if rid != rule_id and not rule.get("is_default") and rule.get("apply_to") == new_apply_to:
                    rule["apply_to"] = None

        rule_data["updated_at"] = time.time()
        data["rules"][rule_id] = rule_data

        self.core_api.data_manager.save_user_data(
            data, filename, user_hash, obfuscated=True
        )
        return rule_data

    def delete_rule(self, user_hash, rule_id):
        # Cannot delete default rules
        if rule_id in DEFAULT_RULES:
            return False

        filename = self._get_scenarios_filename()
        data = self.get_all_scenarios(user_hash)
        if rule_id in data.get("rules", {}):
            del data["rules"][rule_id]
            self.core_api.data_manager.save_user_data(
                data, filename, user_hash, obfuscated=True
            )
            return True
        return False

    def reset_rule(self, user_hash, rule_id):
        if rule_id not in DEFAULT_RULES:
            return None
        
        filename = self._get_scenarios_filename()
        data = self.get_all_scenarios(user_hash)
        
        rule_data = {
            **DEFAULT_RULES[rule_id],
            "created_at": time.time(),
            "updated_at": time.time()
        }
        
        data["rules"][rule_id] = rule_data
        
        self.core_api.data_manager.save_user_data(
            data, filename, user_hash, obfuscated=True
        )
        return rule_data

    def get_rule_content(self, user_hash, rule_id):
        """Get a single rule's content by ID, checking apply_to overrides first."""
        data = self.get_all_scenarios(user_hash)
        rules = data.get("rules", {})
        
        # Check if any custom rule overrides this rule_id via apply_to
        for custom_rule_id, custom_rule in rules.items():
            if not custom_rule.get("is_default") and custom_rule.get("apply_to") == rule_id:
                return custom_rule.get("content", "")
                
        rule = rules.get(rule_id)
        if rule:
            return rule.get("content", "")
        return ""

    def get_formatted_chat_rule(self, user_hash, data):
        """Get the chat_format rule and populate it with current context data."""
        chat_format_rule = self.get_rule_content(user_hash, 'chat_format')
        if not chat_format_rule:
            return ""

        import json

        emotion_rules = data.get('emotion_rules')
        emotion_types_info = ""
        example_emotion = "null"
        if emotion_rules:
            types = emotion_rules.get('types', [])
            if isinstance(types, dict):
                all_types = types.get('emotion', []) + types.get('condition', [])
            else:
                all_types = types
            max_types = emotion_rules.get('max_types', 3)
            emotion_types_info = (
                f'  - "emotion": {{"type": value, ...}} | null — emotional state. '
                f'Pick up to {max_types} from {json.dumps(all_types)} with intensity '
                f'(1=mild, 5=moderate, 10=strong), or null if unchanged.'
            )
            example_emotion = '{"happy": 5, "embarrassed": 10}'

        action_rules = data.get('action_rules')
        action_types_info = ""
        example_action = "null"
        if action_rules:
            raw_solo = list(action_rules.get('solo_types', {}).keys())
            duo_types = list(action_rules.get('duo_types', {}).keys())
            max_active = action_rules.get('max_active_types', 2)
            # Ensure stop/idle are listed in solo types
            solo_types = raw_solo[:]
            for t in ['idle', 'stop']:
                if t not in solo_types:
                    solo_types.append(t)
            user_name = data.get("user_name", "User")
            action_types_info = (
                f'  - "action": ["type1", ...] | null — current physical action/pose. '
                f'Pick up to {max_active} total, or null if unchanged.\n'
                f'    Solo types: {json.dumps(solo_types)} (use "idle" or "stop" to end all actions)\n'
            )
            if duo_types:
                action_types_info += (
                    f'    Intimate/duo types (involve both you and {user_name}): {json.dumps(duo_types)}\n'
                    f'    Once a duo action is active, only another duo action or "stop" can replace it.'
                )
            example_action = '["sitting"]'

        available_capabilities = data.get('available_capabilities', [])
        capabilities_info = ""
        if available_capabilities:
            lines = ["You also have the following capabilities:"]
            for cap in available_capabilities:
                llm_name = cap.get('llmName', cap.get('id', 'Unknown'))
                desc = cap.get('description', 'No description')
                lines.append(f"- {llm_name}: {desc}")
            lines.append('To use: <call_capability name="capability_name">{{...JSON...}}</call_capability> at the VERY END.')
            capabilities_info = "\n".join(lines)

        # Build a complete example JSON with all required fields
        other_member_names = data.get('other_member_names', [])
        example_mentioned = [other_member_names[0]] if other_member_names else []
        example_obj = {
            "location": "School classroom",
            "put_on": None,
            "take_off": None,
            "mentioned": example_mentioned,
            "time_skip": False,
        }
        if emotion_rules:
            example_obj["emotion"] = {"happy": 5, "embarrassed": 10}
        if action_rules:
            example_obj["action"] = ["sitting"]
        example_json = json.dumps(example_obj, ensure_ascii=False)

        chat_format_rule = chat_format_rule.replace("{{emotion_types_info}}", emotion_types_info)
        chat_format_rule = chat_format_rule.replace("{{action_types_info}}", action_types_info)
        chat_format_rule = chat_format_rule.replace("{{example_json}}", example_json)
        chat_format_rule = chat_format_rule.replace("{{capabilities_info}}", capabilities_info)

        # Inject hint about available character names for "mentioned" field
        other_member_names = data.get('other_member_names', [])
        if other_member_names:
            names_str = ', '.join(f'"{n}"' for n in other_member_names)
            mentioned_hint = f' Available names in this group: [{names_str}].'
        else:
            mentioned_hint = ''
        chat_format_rule = chat_format_rule.replace("{{mentioned_names_hint}}", mentioned_hint)

        return chat_format_rule

    def get_formatted_discord_chat_rule(self, user_hash, data):
        """Get the chat_discord_system rule and populate it with current language preferences."""
        discord_rule = self.get_rule_content(user_hash, 'chat_discord_system')
        if not discord_rule:
            return ""

        primary_language = str(data.get('primary_language') or 'English').strip() or 'English'
        secondary_language = str(data.get('secondary_language') or 'Japanese').strip() or 'Japanese'

        discord_rule = discord_rule.replace("{{primary_language}}", primary_language)
        discord_rule = discord_rule.replace("{{secondary_language}}", secondary_language)

        return discord_rule

    def get_scene_by_id(self, user_hash, scene_id):
        """Get a single scene by ID."""
        data = self.get_all_scenarios(user_hash)
        return data.get("scenes", {}).get(scene_id)
