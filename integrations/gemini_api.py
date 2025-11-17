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
    model: str = "gemini-2.5-flash-lite",
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    user_api_key: Optional[str] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_mode: Optional[str] = None,
    tool_executor: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    max_turns: int = 3,
) -> Dict[str, Any]:
    """
    Multi-turn chat with optional tool-calling execution.

    - Accepts OpenAI-style messages ({role, content}) or Gemini-style ({role, parts}).
    - On first round, passes tool declarations to the model. If the model responds
      with a function_call, optionally executes it (when tool_executor is provided)
      and sends a follow-up turn with function_response parts.
    - Returns a dict containing at least {role, parts, text} on success, or an
      error payload on failure.
    """
    client = _get_client(user_api_key)

    def _role_map(r: str) -> str:
        return "model" if r in ("assistant", "model") else "user"

    def _build_parts_from_msg(msg: Dict[str, Any]) -> List[Part]:
        parts: List[Part] = []
        raw_parts = msg.get("parts")
        if isinstance(raw_parts, list) and raw_parts:
            for p in raw_parts:
                if isinstance(p, dict):
                    if "text" in p:
                        parts.append(Part(text=str(p.get("text", ""))))
                    elif "function_call" in p and isinstance(p["function_call"], dict):
                        fc = p["function_call"]
                        name = str(fc.get("name", "")) if isinstance(fc.get("name"), (str, bytes)) else str(fc.get("name", ""))
                        args = fc.get("args")
                        # Leave args as plain dict; SDK will serialize
                        parts.append(Part(function_call=types.FunctionCall(name=name, args=args or {})))
                    elif "function_response" in p and isinstance(p["function_response"], dict):
                        fr = p["function_response"]
                        fname = str(fr.get("name", ""))
                        resp = fr.get("response")
                        parts.append(Part(function_response=types.FunctionResponse(name=fname, response=resp)))
        else:
            # Fallback to text/content fields
            txt = msg.get("text")
            if txt is None:
                txt = msg.get("content", "")
            parts.append(Part(text=str(txt or "")))
        return parts

    # Work on a local copy of conversation, as we append model/tool messages.
    history: List[Dict[str, Any]] = [dict(m) for m in (conversation or []) if isinstance(m, dict)]

    for turn in range(max_turns):
        # 1) Build request config
        config_kwargs: Dict[str, Any] = {"safety_settings": DEFAULT_SAFETY}
        if temperature is not None:
            config_kwargs["temperature"] = temperature
        if max_tokens is not None:
            config_kwargs["max_output_tokens"] = max_tokens

        # Only pass tools on the first call of this multi-turn exchange (via config, not top-level args)
        if tools and turn == 0:
            # Convert JSON Schema -> Gemini Schema (drop anyOf/required/oneOf etc.)
            def _schema_from_json(candidate: Any) -> types.Schema:
                def _type_of(val: Any) -> str:
                    vt = str(val or "object").lower()
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
                    return "OBJECT"

                try:
                    if not isinstance(candidate, dict):
                        return types.Schema(type="OBJECT")

                    t = _type_of(candidate.get("type", "object")).upper()

                    if t == "ARRAY":
                        items_def = candidate.get("items")
                        if isinstance(items_def, dict):
                            return types.Schema(type="ARRAY", items=_schema_from_json(items_def))
                        return types.Schema(type="ARRAY", items=types.Schema(type="STRING"))

                    if t != "OBJECT":
                        return types.Schema(type=t)

                    props = candidate.get("properties") or {}
                    prop_schemas: Dict[str, types.Schema] = {}
                    if isinstance(props, dict):
                        for key, val in props.items():
                            if isinstance(val, dict):
                                vtype = _type_of(val.get("type", "string"))
                                if vtype == "ARRAY":
                                    items_def = val.get("items")
                                    if isinstance(items_def, dict):
                                        prop_schemas[key] = types.Schema(type="ARRAY", items=_schema_from_json(items_def))
                                    else:
                                        prop_schemas[key] = types.Schema(type="ARRAY", items=types.Schema(type="STRING"))
                                elif vtype == "OBJECT":
                                    prop_schemas[key] = _schema_from_json(val)
                                else:
                                    prop_schemas[key] = types.Schema(type=vtype)
                            else:
                                prop_schemas[key] = types.Schema(type="STRING")

                    # Intentionally ignore required/anyOf/oneOf to satisfy Gemini's schema constraints
                    return types.Schema(type="OBJECT", properties=prop_schemas)
                except Exception:
                    return types.Schema(type="OBJECT")

            try:
                fn_decls: List[types.FunctionDeclaration] = []
                for tdef in tools:
                    if not isinstance(tdef, dict):
                        continue
                    name = str(tdef.get("name") or "").strip()
                    if not name:
                        continue
                    description = tdef.get("description") or ""
                    params = tdef.get("parameters") or {"type": "object"}
                    schema = _schema_from_json(params)
                    fn_decls.append(
                        types.FunctionDeclaration(
                            name=name,
                            description=description,
                            parameters=schema,
                        )
                    )
                if fn_decls:
                    config_kwargs["tools"] = [types.Tool(function_declarations=fn_decls)]
            except Exception as e:  # noqa: BLE001
                print(f"[GeminiAPI chat] Ignoring tools due to construction error: {e}")

        config = types.GenerateContentConfig(**config_kwargs)

        # 2) Convert history to Content objects
        contents: List[Content] = []
        for msg in history:
            try:
                role = _role_map(str(msg.get("role", "user")))
                parts = _build_parts_from_msg(msg)
                contents.append(Content(role=role, parts=parts))
            except Exception:
                continue

        # 3) Make API call
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as e:  # noqa: BLE001
            print(f"[GeminiAPI Error chat] Model: {model}, Error: {e}")
            return {"role": "model", "text": f"An error occurred: {e}"}

        # 4) Parse response content into a plain dict shape
        try:
            cand = response.candidates[0]
            content = cand.content
            parts_list: List[Dict[str, Any]] = []
            for part in content.parts:
                part_dict: Dict[str, Any] = {}
                if hasattr(part, "text") and part.text:
                    part_dict["text"] = part.text
                if hasattr(part, "function_call") and part.function_call:
                    fc = part.function_call
                    # Normalize args to a plain dict
                    args = {}
                    try:
                        args = {k: v for k, v in getattr(fc, "args", {}).items()}
                    except Exception:
                        try:
                            raw = getattr(fc, "args", None)
                            if isinstance(raw, dict):
                                args = dict(raw)
                            elif isinstance(raw, str):
                                args = json.loads(raw)
                        except Exception:
                            args = {}
                    part_dict["function_call"] = {"name": getattr(fc, "name", None), "args": args}
                if part_dict:
                    parts_list.append(part_dict)

            response_dict: Dict[str, Any] = {"role": content.role, "parts": parts_list}

            # 5) Decide next step: tool call(s) or final text
            parts_for_decision = response_dict.get("parts", [])
            has_fc = any(isinstance(p, dict) and p.get("function_call") for p in parts_for_decision)
            if has_fc:
                # If no executor is provided, return tool_call(s) for the caller to handle
                if not tool_executor:
                    requested_calls = [
                        p["function_call"]
                        for p in parts_for_decision
                        if isinstance(p, dict) and p.get("function_call")
                    ]
                    # Backward compatible single-call shape
                    if len(requested_calls) == 1:
                        fc = requested_calls[0] or {}
                        name = fc.get("name")
                        args = fc.get("args") or {}
                        return {"type": "tool_call", "name": name, "arguments": args, "text": ""}
                    # New multi-call shape: return all calls at once
                    calls = []
                    for fc in requested_calls:
                        try:
                            calls.append({
                                "name": fc.get("name"),
                                "arguments": (fc.get("args") or {}),
                            })
                        except Exception:
                            pass
                    return {"type": "tool_calls", "calls": calls, "text": ""}

                # Append model tool request and respond with tool results (server-side execution)
                history.append(response_dict)

                requested_calls = [p["function_call"] for p in response_dict["parts"] if isinstance(p, dict) and p.get("function_call")]
                tool_responses = []
                for call in requested_calls:
                    try:
                        result = tool_executor(call)
                    except Exception as ex:
                        result = {"error": str(ex)}
                    tool_responses.append({
                        "function_response": {
                            "name": call.get("name"),
                            "response": result,
                        }
                    })

                history.append({"role": "user", "parts": tool_responses})
                # Continue next loop turn to let the model finish
            else:
                # Finalize with text aggregation
                history.append(response_dict)
                final_text = "".join(p.get("text", "") for p in response_dict.get("parts", []))
                ret = dict(response_dict)
                ret["text"] = final_text
                return ret

        except Exception as parse_err:  # noqa: BLE001
            # Fallback to response.text when parsing parts fails
            try:
                txt = getattr(response, "text", "")
            except Exception:
                txt = ""
            return {"role": "model", "text": txt or f"Parse error: {parse_err}"}

    # Safety valve if we didn't return earlier
    return {"role": "model", "text": "Reached max turns without a final answer."}

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
