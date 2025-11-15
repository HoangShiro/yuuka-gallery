from google import genai
from google.genai import types
from google.genai.types import (SafetySetting, HarmCategory, HarmBlockThreshold,
                                Content, Part, WeightedPrompt,
                                LiveMusicGenerationConfig, SpeechConfig,
                                VoiceConfig, PrebuiltVoiceConfig)
import os
from dotenv import load_dotenv
import asyncio
import json
from typing import Dict, Any, List, Optional, Callable, Coroutine

primary_env_path = os.path.join(os.path.dirname(__file__), "..", "..", "configs", ".env")
fallback_env_path = os.path.join(os.path.dirname(__file__), "..", "..", "users", ".env")

if os.path.exists(primary_env_path):
    load_dotenv(primary_env_path)
else:
    load_dotenv(fallback_env_path)

DEFAULT_API_KEY = os.getenv("GEMINI-KEY") or os.getenv("GOOGLE_GEMINI_KEY")

def _get_client(user_api_key: Optional[str] = None, client_options: Optional[Dict[str, Any]] = None) -> genai.Client:
    """
    Khởi tạo và trả về một instance của genai.Client.
    Ưu tiên sử dụng `user_api_key` nếu được cung cấp, nếu không sẽ dùng `DEFAULT_API_KEY`.
    
    :param user_api_key: Khóa API do người dùng cung cấp.
    :param client_options: Các tùy chọn bổ sung khi khởi tạo client (ví dụ: cho Lyria).
    :return: Một instance của genai.Client.
    :raises RuntimeError: Nếu không có khóa API nào được cung cấp.
    """
    final_api_key = user_api_key if user_api_key and user_api_key.strip() else DEFAULT_API_KEY
    if not final_api_key:
        raise RuntimeError("Gemini API key not provided by user and no default key is configured.")
    
    client_kwargs = {'api_key': final_api_key}
    if client_options:
        client_kwargs.update(client_options)
        
    return genai.Client(**client_kwargs)

DEFAULT_SAFETY = [
    SafetySetting(category=HarmCategory.HARM_CATEGORY_HARASSMENT, threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold=HarmBlockThreshold.BLOCK_NONE),
    SafetySetting(category=HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold=HarmBlockThreshold.BLOCK_NONE),
]

def list_models(user_api_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Return a list of available Gemini models for the provided API key.
    Each item includes: { id: str, name: str, supported_generation_methods?: list[str] }.
    """
    client = _get_client(user_api_key)
    models: List[Dict[str, Any]] = []
    try:
        # New genai client exposes .models.list()
        iterable = client.models.list()
        for m in iterable:
            # Be defensive across SDK versions: prefer name, fallback to id
            full_name = getattr(m, "name", None) or getattr(m, "id", None)
            if not full_name:
                continue
            # Normalize to short id without the "models/" prefix if present
            short_id = full_name.split("/")[-1] if isinstance(full_name, str) else full_name
            methods = getattr(m, "supported_generation_methods", None)
            if methods is None:
                # Some SDK versions may use different attribute naming
                methods = getattr(m, "generation_methods", None)
            try:
                methods_list = list(methods) if methods is not None else []
            except Exception:  # noqa: BLE001
                methods_list = []
            models.append({
                "id": short_id,
                "name": short_id,
                "full_name": full_name,
                "supported_generation_methods": methods_list,
            })
    except Exception as e:  # noqa: BLE001
        # Surface meaningful error to caller
        raise RuntimeError(f"Failed to list Gemini models: {e}") from e
    return models

async def generate_with_retry(
    api_call_func: Callable[..., Coroutine], 
    model: str, 
    retry_model: str, 
    user_api_key: Optional[str] = None,
    **kwargs
) -> Any:
    """
    Một wrapper để thực hiện gọi API Gemini với cơ chế thử lại cho lỗi 503.
    Nếu lần gọi đầu tiên với `model` thất bại với lỗi 503, nó sẽ thử lại một lần với `retry_model`.
    """
    try:
        return await api_call_func(model=model, user_api_key=user_api_key, **kwargs)
    except Exception as e:
        if "503" in str(e) or "Service Unavailable" in str(e):
            print(f"⚠️ [GeminiAPI] Model '{model}' returned 503. Retrying with '{retry_model}'...")
            try:
                return await api_call_func(model=retry_model, user_api_key=user_api_key, **kwargs)
            except Exception as retry_e:
                print(f"💥 [GeminiAPI] Retry with '{retry_model}' also failed: {retry_e}")
                raise retry_e from e
        else:
            raise e

async def generate_content_with_image(
    prompt: str, 
    image_bytes: bytes, 
    model: str = "gemini-1.5-flash-latest", 
    temperature: float = None, 
    max_tokens: int = None,
    user_api_key: Optional[str] = None,
    **kwargs
) -> Dict:
    """
    Tạo output JSON từ một prompt có chứa hình ảnh.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    config_parts = {"response_mime_type": "application/json", "safety_settings": DEFAULT_SAFETY}
    if temperature is not None: config_parts['temperature'] = temperature
    if max_tokens is not None: config_parts['max_output_tokens'] = max_tokens
    config = types.GenerateContentConfig(**config_parts)

    content_parts = [
        prompt,
        types.Part.from_bytes(data=image_bytes, mime_type='image/jpeg')
    ]
    
    try:
        response = await client.aio.models.generate_content(
            model=model, 
            contents=content_parts,
            config=config
        )
        return json.loads(response.text)
    except json.JSONDecodeError as e_json:
        print(f"[GeminiAPI Error generate_content_with_image] JSONDecodeError: {e_json}. Response text: {getattr(response, 'text', 'N/A')}")
        raise 
    except Exception as e:
        print(f"[GeminiAPI Error generate_content_with_image] Model: {model}, Error: {e}")
        raise

async def generate_text(
    prompt: str, 
    model: str = "gemini-2.5-flash", 
    temperature: float = None, 
    max_tokens: int = None,
    user_api_key: Optional[str] = None
) -> str:
    """
    Tạo văn bản sử dụng Gemini API.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    config = types.GenerateContentConfig(safety_settings=DEFAULT_SAFETY)
    if temperature is not None: config.temperature = temperature
    if max_tokens is not None: config.max_output_tokens = max_tokens
    
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=config
        )
        return response.text
    except Exception as e:
        print(f"[GeminiAPI Error generate_text] Model: {model}, Error: {e}")
        return f"Error generating text: {e}"

async def chat(
    conversation: list[dict], 
    model: str = "gemini-2.5-flash", 
    temperature: float = None, 
    max_tokens: int = None,
    user_api_key: Optional[str] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_mode: Optional[str] = None,
) -> Any:
    """Chat với Gemini API, sử dụng lịch sử hội thoại.

    Hỗ trợ bổ sung function calling thông qua tham số ``tools`` và ``tool_mode``.
    Khi có tools, hàm sẽ cấu hình tool_config theo spec của Gemini và trả về
    một dict JSON thay vì chỉ plain text, ví dụ:

    - {"type": "message", "text": "..."}
    - {"type": "tool_call", "name": "...", "arguments": {...}}
    """
    client = _get_client(user_api_key)

    # Build history contents except the last message (current user input).
    # Fallback to `content` when `text` is absent, so upstream callers that use
    # OpenAI-style {role, content} messages still work.
    history_contents = []
    for msg in conversation[:-1]:
        try:
            if not isinstance(msg, dict):
                continue
            role = "model" if msg.get("role") in ["assistant", "model"] else "user"
            txt = msg.get("text")
            if txt is None:
                txt = msg.get("content", "")
            history_contents.append(
                Content(
                    role=role,
                    parts=[Part(text=str(txt or ""))],
                )
            )
        except Exception as _e:  # noqa: BLE001
            # Skip malformed history entry but continue gracefully.
            continue

    try:
        last_msg = conversation[-1] if conversation else {"role": "user", "text": ""}

        # Base config with safety + sampling
        config_kwargs: Dict[str, Any] = {"safety_settings": DEFAULT_SAFETY}
        if temperature is not None:
            config_kwargs["temperature"] = temperature
        if max_tokens is not None:
            config_kwargs["max_output_tokens"] = max_tokens

        # Optional: map our tools (simple JSON schema-like) into Gemini tool declarations.
        # Note: In the google-genai SDK, tools and tool_config are request-level args,
        # not part of GenerateContentConfig. We therefore pass them to generate_content.
        request_tools = None
        request_tool_config = None
        
        def _schema_from_json(candidate: Any) -> types.Schema:
            """Best-effort JSON Schema → Gemini Schema converter.
            Handles OBJECT with nested properties and ARRAY with items.
            Drops constraints like anyOf/oneOf/required for safety.
            """
            def _type_of(val: Any) -> str:
                vt = str(val or "string").lower()
                if vt == "string":
                    return "STRING"
                if vt == "number":
                    return "NUMBER"
                if vt == "integer":
                    return "INTEGER"
                if vt == "boolean":
                    return "BOOLEAN"
                if vt == "array":
                    return "ARRAY"
                if vt == "object":
                    return "OBJECT"
                return "STRING"

            try:
                if not isinstance(candidate, dict):
                    return types.Schema(type="OBJECT")

                t = _type_of(candidate.get("type", "object")).upper()

                if t == "ARRAY":
                    items_def = candidate.get("items")
                    if isinstance(items_def, dict):
                        return types.Schema(type="ARRAY", items=_schema_from_json(items_def))
                    # Default items to STRING to satisfy SDK requirement
                    return types.Schema(type="ARRAY", items=types.Schema(type="STRING"))

                if t != "OBJECT":
                    return types.Schema(type=t)

                props = candidate.get("properties") or {}
                prop_schemas: Dict[str, types.Schema] = {}
                if isinstance(props, dict):
                    for key, val in props.items():
                        if isinstance(val, dict):
                            val_type = _type_of(val.get("type", "string"))
                            if val_type == "ARRAY":
                                items_def = val.get("items")
                                if isinstance(items_def, dict):
                                    prop_schemas[key] = types.Schema(type="ARRAY", items=_schema_from_json(items_def))
                                else:
                                    prop_schemas[key] = types.Schema(type="ARRAY", items=types.Schema(type="STRING"))
                            elif val_type == "OBJECT":
                                # Recurse into nested object
                                prop_schemas[key] = _schema_from_json(val)
                            else:
                                prop_schemas[key] = types.Schema(type=val_type)
                        else:
                            prop_schemas[key] = types.Schema(type="STRING")

                return types.Schema(type="OBJECT", properties=prop_schemas)
            except Exception as _e:  # noqa: BLE001
                return types.Schema(type="OBJECT")

        if tools:
            fn_decls: List[types.FunctionDeclaration] = []
            for t in tools:
                try:
                    name = str(t.get("name") or "").strip()
                    if not name:
                        continue
                    description = t.get("description") or ""
                    params = t.get("parameters") or {"type": "object"}
                    schema = _schema_from_json(params)
                    fn_decls.append(
                        types.FunctionDeclaration(
                            name=name,
                            description=description,
                            parameters=schema,
                        )
                    )
                except Exception as e:  # noqa: BLE001
                    print(f"[GeminiAPI] Skipping invalid tool definition {t}: {e}")

            if fn_decls:
                try:
                    request_tools = [types.Tool(function_declarations=fn_decls)]
                except Exception as e:  # noqa: BLE001
                    print(f"[GeminiAPI] Failed to construct Tool list: {e}")

                try:
                    mode_val = (tool_mode or "AUTO").upper()
                    if mode_val not in {"AUTO", "ANY", "NONE"}:
                        mode_val = "AUTO"
                    request_tool_config = types.ToolConfig(
                        function_calling_config=types.FunctionCallingConfig(mode=mode_val)
                    )
                except Exception as e:  # noqa: BLE001
                    print(f"[GeminiAPI] Failed to construct ToolConfig: {e}")

        config = types.GenerateContentConfig(**config_kwargs)

        # When tools are present, we always use the models.generate_content endpoint
        # instead of the older chat_session API so we can access full candidates.
        contents: List[Content] = list(history_contents)
        # Current user message (or assistant if role provided). Support both text/content.
        current_text = last_msg.get("text")
        if current_text is None:
            current_text = last_msg.get("content", "")
        contents.append(
            Content(
                role="user" if last_msg.get("role") not in ["assistant", "model"] else "model",
                parts=[Part(text=str(current_text or ""))],
            )
        )

        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=config,
                tools=request_tools,
                tool_config=request_tool_config,
            )
        except TypeError as te:
            # Older SDKs may not accept top-level tools/tool_config; try embedding in config.
            if "unexpected keyword argument 'tools'" in str(te) or "unexpected keyword argument 'tool_config'" in str(te):
                try:
                    config_with_tools_kwargs = dict(config_kwargs)
                    if request_tools is not None:
                        config_with_tools_kwargs["tools"] = request_tools
                    if request_tool_config is not None:
                        config_with_tools_kwargs["tool_config"] = request_tool_config
                    config_with_tools = types.GenerateContentConfig(**config_with_tools_kwargs)
                    response = await client.aio.models.generate_content(
                        model=model,
                        contents=contents,
                        config=config_with_tools,
                    )
                except Exception as e_cfg:  # noqa: BLE001
                    print(f"[GeminiAPI] Failed embedding tools into config: {e_cfg}. Falling back without tools.")
                    response = await client.aio.models.generate_content(
                        model=model,
                        contents=contents,
                        config=config,
                    )
            else:
                raise

        # If no tools were requested, behave like old implementation: return plain text.
        if not tools:
            return getattr(response, "text", "")

        # With tools enabled, inspect the first candidate for function calls.
        try:
            candidates = getattr(response, "candidates", None) or []
            if not candidates:
                return {"type": "message", "text": getattr(response, "text", "")}
            cand = candidates[0]
            content = getattr(cand, "content", None)
            parts = getattr(content, "parts", None) or []
            # Collect any text parts for reply text (Gemini may include both function_call and natural language guidance).
            reply_texts = []
            for p in parts:
                try:
                    ptext = getattr(p, "text", None) or (p.get("text") if isinstance(p, dict) else None)
                    if ptext:
                        reply_texts.append(str(ptext))
                except Exception:
                    continue
            for part in parts:
                # New SDKs may expose function calls via attributes like function_call
                fn_call = getattr(part, "function_call", None) or getattr(part, "functionCall", None)
                if fn_call:
                    # Fallback extraction of name/args supporting multiple SDK shapes
                    name = None
                    args = None
                    # Attribute access
                    try:
                        name = getattr(fn_call, "name", None)
                    except Exception:
                        name = None
                    try:
                        args = getattr(fn_call, "args", None)
                    except Exception:
                        args = None
                    # Alternate attribute names
                    if not name:
                        try:
                            name = getattr(fn_call, "function_name", None)
                        except Exception:
                            pass
                    if args is None:
                        try:
                            args = getattr(fn_call, "arguments", None)
                        except Exception:
                            pass
                    # Dict style
                    if isinstance(fn_call, dict):
                        if not name:
                            name = fn_call.get("name") or fn_call.get("function_name")
                        if args is None:
                            args = fn_call.get("args") or fn_call.get("arguments")
                    # __dict__ fallback
                    if (not name or args is None) and hasattr(fn_call, "__dict__"):
                        try:
                            rawd = fn_call.__dict__
                            if not name:
                                name = rawd.get("name") or rawd.get("function_name")
                            if args is None:
                                args = rawd.get("args") or rawd.get("arguments")
                        except Exception:
                            pass
                    # Final guard: ensure name is a usable string
                    if name is None:
                        try:
                            name = str(name) if name else None
                        except Exception:
                            name = None
                    # Some SDKs encode args as JSON string; try to decode
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:  # noqa: BLE001
                            pass
                    # Ensure arguments are plain JSON-serializable primitives
                    def _simplify(val):
                        if isinstance(val, dict):
                            return {k: _simplify(v) for k, v in val.items()}
                        if isinstance(val, list):
                            return [_simplify(v) for v in val]
                        if isinstance(val, (str, int, float, bool)) or val is None:
                            return val
                        if hasattr(val, "__dict__"):
                            try:
                                return _simplify(vars(val))
                            except Exception:  # noqa: BLE001
                                return str(val)
                        return str(val)
                    safe_args = _simplify(args or {})
                    raw_fc = getattr(part, "function_call", None) or getattr(part, "functionCall", None)
                    # Convert raw function call object to a minimal dict to avoid Flask serialization errors
                    if raw_fc and not isinstance(raw_fc, (dict, list, str, int, float, bool, type(None))):
                        raw_fc = {
                            "name": getattr(raw_fc, "name", None),
                            "args": _simplify(getattr(raw_fc, "args", {})),
                        }
                    return {
                        "type": "tool_call",
                        "name": name,
                        "arguments": safe_args,
                        "raw": raw_fc,
                        "text": "\n".join(reply_texts).strip() if reply_texts else "",
                        "_debug_extraction": {
                            "name_is_none": name is None,
                            "raw_type": type(fn_call).__name__,
                            "args_keys": list(safe_args.keys()) if isinstance(safe_args, dict) else None,
                        },
                    }

            # If no explicit function_call found, fallback to text message.
            return {"type": "message", "text": getattr(response, "text", "")}
        except Exception as parse_err:  # noqa: BLE001
            print(f"[GeminiAPI] Failed to parse tool call response: {parse_err}")
            return {"type": "message", "text": getattr(response, "text", "")}

    except Exception as e:  # noqa: BLE001
        print(f"[GeminiAPI Error chat] Model: {model}, Error: {e}")
        return {"type": "error", "error": str(e)}

async def stream_chat(
    conversation: list[dict],
    model: str = "gemini-2.5-flash",
    temperature: float = None,
    max_tokens: int = None,
    user_api_key: Optional[str] = None,
):
    """
    Stream chat responses from Gemini API, yielding incremental text chunks.
    :param user_api_key: Optional API key provided by the user.
    """
    if not conversation:
        raise ValueError("Conversation must contain at least one message.")

    client = _get_client(user_api_key)

    def _to_part(text: str) -> Part:
        return Part(text=text)

    contents: list[Content] = []
    for msg in conversation:
        text = msg.get("text", "")
        if not isinstance(text, str) or not text.strip():
            continue
        role = "model" if msg.get("role") in ["assistant", "model"] else "user"
        contents.append(Content(role=role, parts=[_to_part(text)]))

    if not contents:
        raise ValueError("Conversation did not contain any textual content.")

    config_kwargs = {"safety_settings": DEFAULT_SAFETY}
    if temperature is not None:
        config_kwargs["temperature"] = temperature
    if max_tokens is not None:
        config_kwargs["max_output_tokens"] = max_tokens
    config = types.GenerateContentConfig(**config_kwargs)

    try:
        stream = await client.aio.models.generate_content_stream(
            model=model,
            contents=contents,
            config=config,
        )
        async for chunk in stream:
            if getattr(chunk, "text", None):
                yield chunk.text
                continue
            if chunk.candidates and chunk.candidates[0].content:
                for part in chunk.candidates[0].content.parts:
                    if part.text:
                        yield part.text
    except Exception as e:
        print(f"[GeminiAPI Error stream_chat] Model: {model}, Error: {e}")
        raise

async def generate_structured_json(
    prompt: str, 
    model: str = "gemini-2.5-flash", 
    temperature: float = None, 
    max_tokens: int = None,
    user_api_key: Optional[str] = None,
    **kwargs
):
    """
    Tạo output JSON có cấu trúc từ một prompt.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    config_parts = {"response_mime_type": "application/json", "safety_settings": DEFAULT_SAFETY}
    if temperature is not None: config_parts['temperature'] = temperature
    if max_tokens is not None: config_parts['max_output_tokens'] = max_tokens
    config = types.GenerateContentConfig(**config_parts)
    
    try:
        response = await client.aio.models.generate_content(
            model=model, 
            contents=prompt,
            config=config
        )
        return json.loads(response.text)
    except json.JSONDecodeError as e_json:
        print(f"[GeminiAPI Error generate_structured_json] JSONDecodeError: {e_json}. Response text: {getattr(response, 'text', 'N/A')}")
        raise 
    except Exception as e:
        print(f"[GeminiAPI Error generate_structured_json] Model: {model}, Error: {e}")
        raise

async def generate_user_memory_update(
    prompt: str, 
    model: str = "gemini-2.5-flash-lite", 
    temperature: float = 0.5, 
    max_tokens: int = 300,
    user_api_key: Optional[str] = None
) -> Dict[str, str]:
    """
    Tạo bản tóm tắt người dùng và ấn tượng của bot, trả về JSON.
    :param user_api_key: Khóa API tùy chọn của người dùng, được truyền xuống hàm con.
    """
    try:
        response_json = await generate_structured_json(
            prompt=prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            user_api_key=user_api_key
        )
        
        if isinstance(response_json, dict) and "updated_summary" in response_json and "updated_impression" in response_json:
            return {
                "updated_summary": str(response_json["updated_summary"]),
                "updated_impression": str(response_json["updated_impression"])
            }
        else:
            print(f"[GeminiAPI generate_user_memory_update] Error: Unexpected JSON structure. Response: {response_json}")
            return {"updated_summary": "Error: Could not generate summary.", "updated_impression": "Error: Could not generate impression. (Unexpected JSON structure)"}
    except Exception as e:
        print(f"[GeminiAPI generate_user_memory_update] Error: {e}")
        return {"updated_summary": "Error: Could not generate summary.", "updated_impression": f"Error: Could not generate impression. ({type(e).__name__})"}

async def generate_image(
    prompt: str, 
    model: str = "imagen-3.0-generate-001", 
    number_of_images: int = 1,
    user_api_key: Optional[str] = None
):
    """
    Tạo hình ảnh từ một prompt văn bản.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    config = types.GenerateImagesConfig(number_of_images=number_of_images, safety_filter_level="BLOCK_NONE")

    try:
        result = await client.aio.models.generate_images(model=model, prompt=prompt, config=config)
        return [img.image.image_bytes for img in result.generated_images]
    except Exception as e:
        print(f"[GeminiAPI Error generate_image] Model: {model}, Error: {e}")
        return []

async def generate_music(
    prompts: list[str], 
    bpm: int = 90, 
    temperature: float = 1.0, 
    model: str = "models/lyria-realtime-exp",
    user_api_key: Optional[str] = None
):
    """
    Tạo nhạc sử dụng Lyria RealTime.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    music_client = _get_client(user_api_key, client_options={'http_options': {'api_version': 'v1alpha'}})
    try:
        async with music_client.aio.live.music.connect(model=model) as session:
            await session.set_weighted_prompts(prompts=[WeightedPrompt(text=txt, weight=1.0) for txt in prompts])
            await session.set_music_generation_config(config=LiveMusicGenerationConfig(bpm=bpm, temperature=temperature))
            await session.play()
            message = await session.receive()
            return message.server_content.audio_chunks[0].data
    except Exception as e:
        print(f"[GeminiAPI Error generate_music] Model: {model}, Error: {e}")
        return None 

async def text_to_speech(
    text: str, 
    voice: str = "Kore", 
    model: str = "gemini-2.5-flash-preview-tts",
    user_api_key: Optional[str] = None
):
    """
    Chuyển văn bản thành giọng nói.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    config = types.GenerateContentConfig(response_modalities=["AUDIO"], speech_config=SpeechConfig(voice_config=VoiceConfig(prebuilt_voice_config=PrebuiltVoiceConfig(voice_name=voice))))
    try:
        response = await client.aio.models.generate_content(model=model, contents=text, config=config)
        if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith("audio/"):
                    return part.inline_data.data
        print(f"[GeminiAPI Error text_to_speech] No audio data found in response. Response: {response}")
        return None
    except Exception as e:
        print(f"[GeminiAPI Error text_to_speech] Model: {model}, Error: {e}")
        return None

async def analyze_video(
    video_path: str, 
    prompt: str, 
    model: str = "gemini-2.5-flash",
    user_api_key: Optional[str] = None
):
    """
    Phân tích nội dung video.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    uploaded_file = None 
    try:
        uploaded_file = await asyncio.to_thread(client.files.upload, file=video_path)
        
        while uploaded_file.state.name == "PROCESSING":
            print(f"⏳ Waiting for video file '{os.path.basename(video_path)}' to be processed... State: {uploaded_file.state.name}")
            await asyncio.sleep(10)
            uploaded_file = await asyncio.to_thread(client.files.get, name=uploaded_file.name)
        
        if uploaded_file.state.name != "ACTIVE":
            raise Exception(f"File processing failed or did not become active. Final state: {uploaded_file.state.name}")

        response = await client.aio.models.generate_content(
            model=model, 
            contents=[uploaded_file, prompt], 
            config=types.GenerateContentConfig(safety_settings=DEFAULT_SAFETY)
        )
        return response.text
    except Exception as e:
        print(f"[GeminiAPI Error analyze_video] Model: {model}, Error: {e}")
        return f"Error analyzing video: {e}"
    finally:
        if uploaded_file:
            try:
                await asyncio.to_thread(client.files.delete, name=uploaded_file.name)
                print(f"🗑️ Deleted uploaded file '{uploaded_file.name}' from Gemini storage.")
            except Exception as del_e:
                print(f"⚠️ [GeminiAPI] Could not delete file '{uploaded_file.name}' from storage: {del_e}")

async def analyze_audio(
    audio_path: str, 
    prompt: str, 
    model: str = "gemini-2.5-flash",
    user_api_key: Optional[str] = None
):
    """
    Phân tích nội dung âm thanh.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    try:
        uploaded_file = await asyncio.to_thread(client.files.upload, file=audio_path)
        response = await client.aio.models.generate_content(model=model, contents=[uploaded_file, prompt], config=types.GenerateContentConfig(safety_settings=DEFAULT_SAFETY))
        return response.text
    except Exception as e:
        print(f"[GeminiAPI Error analyze_audio] Model: {model}, Error: {e}")
        return f"Error analyzing audio: {e}"

async def analyze_video(
    video_path: str, 
    prompt: str, 
    model: str = "gemini-2.5-flash",
    user_api_key: Optional[str] = None
):
    """
    Phân tích nội dung video.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    try:
        uploaded_file = await asyncio.to_thread(client.files.upload, file=video_path)
        response = await client.aio.models.generate_content(model=model, contents=[uploaded_file, prompt], config=types.GenerateContentConfig(safety_settings=DEFAULT_SAFETY))
        return response.text
    except Exception as e:
        print(f"[GeminiAPI Error analyze_video] Model: {model}, Error: {e}")
        return f"Error analyzing video: {e}"

async def speech_to_text(
    audio_path: str, 
    model: str = "gemini-2.5-flash",
    user_api_key: Optional[str] = None
):
    """
    Ghi âm từ một file audio.
    :param user_api_key: Khóa API tùy chọn của người dùng.
    """
    client = _get_client(user_api_key)
    try:
        uploaded_file = await asyncio.to_thread(client.files.upload, file=audio_path)
        response = await client.aio.models.generate_content(model=model, contents=[uploaded_file, "Transcribe the audio accurately."], config=types.GenerateContentConfig(safety_settings=DEFAULT_SAFETY))
        return response.text
    except Exception as e:
        print(f"[GeminiAPI Error speech_to_text] Model: {model}, Error: {e}")
        return f"Error transcribing audio: {e}"
