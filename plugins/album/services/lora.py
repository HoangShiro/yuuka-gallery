from __future__ import annotations


class AlbumLoraMixin:
    def _sanitize_selection(self, selection):
        if not isinstance(selection, dict):
            return {}
        cleaned = {}
        for k, v in selection.items():
            key = str(k).strip()
            if not key:
                continue
            if v is None:
                cleaned[key] = None
            else:
                val = str(v).strip()
                cleaned[key] = val if val else None
        return cleaned

    def _sanitize_config(self, config_data):
        if not isinstance(config_data, dict):
            return config_data
        sanitized = {}
        for key, value in config_data.items():
            if isinstance(value, str):
                sanitized[key] = value.strip()
            else:
                sanitized[key] = value
        return sanitized

    # --- Multi-LoRA helpers ---
    def _parse_lora_names_to_list(self, names_val):
        """Accepts list[str] or CSV string and returns list[str] filtered (not None/empty)."""
        result = []
        if isinstance(names_val, list):
            result = [str(s).strip() for s in names_val if str(s).strip()]
        elif isinstance(names_val, str):
            parts = [p.strip() for p in names_val.split(',') if p.strip()]
            result = parts
        return [s for s in result if s.lower() != "none"]

    def _normalize_lora_chain(self, cfg: dict):
        """Build a normalized LoRA chain from config fields.
        Priorities: lora_chain > lora_names > lora_name (single).
        Returns list of dicts: {lora_name, strength_model, strength_clip}.
        """
        if not isinstance(cfg, dict):
            return []

        def_sm = cfg.get('lora_strength_model', self.DEFAULT_CONFIG.get('lora_strength_model', 0.9))
        def_sc = cfg.get('lora_strength_clip', self.DEFAULT_CONFIG.get('lora_strength_clip', 1.0))

        chain = cfg.get('lora_chain')
        normalized = []
        if isinstance(chain, list) and chain:
            for item in chain:
                if isinstance(item, dict):
                    name = item.get('name') or item.get('lora_name') or ''
                    name = str(name).strip()
                    if name and name.lower() != 'none':
                        sm = item.get('strength_model', item.get('lora_strength_model', def_sm))
                        sc = item.get('strength_clip', item.get('lora_strength_clip', def_sc))
                        try:
                            sm = float(sm)
                        except (TypeError, ValueError):
                            sm = def_sm
                        try:
                            sc = float(sc)
                        except (TypeError, ValueError):
                            sc = def_sc
                        normalized.append({
                            'lora_name': name,
                            'strength_model': sm,
                            'strength_clip': sc,
                        })
                elif isinstance(item, str):
                    name = item.strip()
                    if name and name.lower() != 'none':
                        normalized.append({
                            'lora_name': name,
                            'strength_model': def_sm,
                            'strength_clip': def_sc,
                        })
        if normalized:
            return normalized

        names = self._parse_lora_names_to_list(cfg.get('lora_names'))
        if names:
            return [{
                'lora_name': n,
                'strength_model': def_sm,
                'strength_clip': def_sc,
            } for n in names]

        single = cfg.get('lora_name')
        if isinstance(single, str):
            s = single.strip()
            if s and s.lower() != 'none':
                return [{
                    'lora_name': s,
                    'strength_model': def_sm,
                    'strength_clip': def_sc,
                }]
        return []
