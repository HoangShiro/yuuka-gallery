// Maid-chan Settings: LLM API configuration UI
(function(){
  const STORAGE_KEY = 'maid-chan:llm-config';
  const MODELS_KEY = 'maid-chan:llm-models';

  function loadConfig(){
    try{
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if(!raw) return {};
      return JSON.parse(raw);
    }catch(_e){ return {}; }
  }

  function saveConfig(cfg){
    try{
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg || {}));
    }catch(_e){ /* ignore */ }
  }

  function saveModels(models){
    try{
      window.localStorage.setItem(MODELS_KEY, JSON.stringify(models || []));
    }catch(_e){ /* ignore */ }
  }

  function loadModels(){
    try{
      const raw = window.localStorage.getItem(MODELS_KEY);
      if(!raw) return [];
      return JSON.parse(raw);
    }catch(_e){ return []; }
  }

  function init(root){
    if(!root) return;

    const cfg = loadConfig();

    const providerSelect = root.querySelector('.maid-chan-llm-provider');
    const apiKeyInput = root.querySelector('.maid-chan-llm-apikey');
    const endpointRow = root.querySelector('.maid-chan-llm-endpoint-row');
    const endpointInput = root.querySelector('.maid-chan-llm-endpoint');
    const connectBtn = root.querySelector('.maid-chan-llm-connect');
    const statusEl = root.querySelector('.maid-chan-llm-status');
    const modelsSelect = root.querySelector('.maid-chan-llm-models');
    const modelsWrapper = root.querySelector('.maid-chan-llm-models-wrapper');

    const tempSlider = root.querySelector('.maid-chan-llm-slider-temp');
    const tempValue = root.querySelector('.maid-chan-llm-slider-temp-value');
    const topPSlider = root.querySelector('.maid-chan-llm-slider-top-p');
    const topPValue = root.querySelector('.maid-chan-llm-slider-top-p-value');
    const maxTokensSlider = root.querySelector('.maid-chan-llm-slider-max-tokens');
    const maxTokensValue = root.querySelector('.maid-chan-llm-slider-max-tokens-value');

    const setStatus = (msg, isError=false)=>{
      if(!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.classList.toggle('error', !!isError);
    };

    const setLoading = (isLoading)=>{
      if(connectBtn){
        if(isLoading){ connectBtn.disabled = true; }
        else { syncConnectState(); }
      }
      if(modelsSelect){ modelsSelect.disabled = !!isLoading || !modelsSelect.options.length; }
      root.classList.toggle('maid-chan-llm-loading', !!isLoading);
    };

    const providerRequiresKey = (p)=> String(p||'').toLowerCase() !== 'lmstudio';

    const syncEndpointVisibility = ()=>{
      const provider = providerSelect ? providerSelect.value : 'openai';
      const isLM = provider === 'lmstudio';
      if(endpointRow){ endpointRow.classList.toggle('is-hidden', !isLM); }
      if(isLM && endpointInput && !endpointInput.value.trim()){
        const saved = loadConfig();
        endpointInput.value = saved.endpoint || 'http://127.0.0.1:1234';
      }
    };

    const normalizeLmBaseUrl = (raw)=>{
      try{
        let u = String(raw || '').trim();
        if(!u) return '';
        // Strip trailing slashes
        u = u.replace(/\/$/, '');
        // Remove accidental /v1 or /models suffixes; we will add /v1
        u = u.replace(/\/v1\/?$/i, '');
        u = u.replace(/\/models\/?$/i, '');
        return `${u}/v1`;
      }catch(_e){ return raw; }
    };

    const syncConnectState = ()=>{
      const provider = providerSelect ? providerSelect.value : 'openai';
      const needsKey = providerRequiresKey(provider);
      if(connectBtn){
        if(needsKey){
          connectBtn.disabled = !(apiKeyInput && apiKeyInput.value.trim());
        }else{
          connectBtn.disabled = false;
        }
      }
    };

    const syncSlidersToConfig = ()=>{
      const c = loadConfig();
      if(tempSlider && typeof c.temperature === 'number'){
        tempSlider.value = String(c.temperature);
      }
      if(topPSlider && typeof c.top_p === 'number'){
        topPSlider.value = String(c.top_p);
      }
      if(maxTokensSlider && typeof c.max_tokens === 'number'){
        maxTokensSlider.value = String(c.max_tokens);
      }
      updateSliderLabels();
    };

    const updateSliderLabels = ()=>{
      if(tempSlider && tempValue){ tempValue.textContent = tempSlider.value; }
      if(topPSlider && topPValue){ topPValue.textContent = topPSlider.value; }
      if(maxTokensSlider && maxTokensValue){ maxTokensValue.textContent = maxTokensSlider.value; }
    };

    const syncFormFromConfig = ()=>{
      const c = loadConfig();
      if(providerSelect && c.provider){ providerSelect.value = c.provider; }
      if(apiKeyInput && c.api_key){ apiKeyInput.value = c.api_key; }
      if(endpointInput && c.endpoint){ endpointInput.value = c.endpoint; }
      if(modelsSelect && c.model){ modelsSelect.dataset.selectedModel = c.model; }
      syncSlidersToConfig();
      syncEndpointVisibility();
      syncConnectState();
    };

    if(apiKeyInput){
      apiKeyInput.addEventListener('input', ()=>{
        const cfg = loadConfig();
        cfg.api_key = apiKeyInput.value.trim();
        saveConfig(cfg);
        syncConnectState();
      });
      syncConnectState();
    }

    if(providerSelect){
      providerSelect.addEventListener('change', ()=>{
        const cfg = loadConfig();
        cfg.provider = providerSelect.value;
        saveConfig(cfg);
        syncEndpointVisibility();
        syncConnectState();
      });
    }

    if(endpointInput){
      endpointInput.addEventListener('input', ()=>{
        const cfg = loadConfig();
        const val = endpointInput.value.trim();
        cfg.endpoint = (providerSelect && providerSelect.value === 'lmstudio') ? normalizeLmBaseUrl(val) : val;
        saveConfig(cfg);
      });
    }

    if(tempSlider){ tempSlider.addEventListener('input', updateSliderLabels); }
    if(topPSlider){ topPSlider.addEventListener('input', updateSliderLabels); }
    if(maxTokensSlider){ maxTokensSlider.addEventListener('input', updateSliderLabels); }

    async function fetchModels(provider, apiKey){
      const payload = { provider, api_key: apiKey || null };

      // Allow LM Studio to operate without an API key by sending a placeholder
      if(provider === 'lmstudio' && !payload.api_key){
        payload.api_key = 'lm-studio';
      }

      const overrides = {};
      if(provider === 'lmstudio' && endpointInput){
        const ep = endpointInput.value.trim();
        if(ep){ overrides.base_url = normalizeLmBaseUrl(ep); }
      }
      if(Object.keys(overrides).length){
        payload.overrides = overrides;
      }

      try{
        // Ưu tiên dùng coreApi từ namespace plugin, fallback sang window.api / global api
        const maidNamespace = window.Yuuka && window.Yuuka.plugins && window.Yuuka.plugins['maid-chan'];
        const coreApi = (maidNamespace && maidNamespace.coreApi) || window.api || (typeof api !== 'undefined' ? api : null);

        if(coreApi && typeof coreApi.createPluginApiClient === 'function'){
          coreApi.createPluginApiClient('maid');
        }

        const pluginApi = coreApi && coreApi.maid;
        if(pluginApi && typeof pluginApi.post === 'function'){
          const res = await pluginApi.post('/models', payload);
          if(res && typeof res === 'object'){
            if(Array.isArray(res.models)) return res.models;
            if(res.error){
              // Surface backend error so UI can show meaningful message
              throw new Error(String(res.error));
            }
          }
        }else{
          console.warn('[Maid-chan LLM] pluginApi.post is not available', { pluginApi });
        }
      }catch(err){
        throw err;
      }

      throw new Error('Model listing service is not available.');
    }

    const populateModels = (models)=>{
      if(!modelsSelect) return;
      modelsSelect.innerHTML = '';
      // Auto-save models list so we can restore without re-connecting
      saveModels(models || []);
      if(!models || !models.length){
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No models available';
        modelsSelect.appendChild(opt);
        modelsSelect.disabled = true;
        return;
      }
      modelsSelect.disabled = false;
      const c = loadConfig();
      const savedModel = c.model || modelsSelect.dataset.selectedModel || '';
      models.forEach(model=>{
        const opt = document.createElement('option');
        if(typeof model === 'string'){
          opt.value = model;
          opt.textContent = model;
        }else{
          opt.value = model.id || model.name || '';
          opt.textContent = model.display_name || model.id || model.name || opt.value;
        }
        if(savedModel && opt.value === savedModel){ opt.selected = true; }
        modelsSelect.appendChild(opt);
      });
    };

    // After helpers are defined, restore from config + cached models
    const cachedModels = loadModels();
    syncFormFromConfig();

    if(modelsSelect && cachedModels && cachedModels.length){
      // Pre-populate models dropdown from cached list so user sees last models immediately
      populateModels(cachedModels);
    }

    if(connectBtn){
      connectBtn.addEventListener('click', async ()=>{
        const provider = providerSelect ? providerSelect.value : 'openai';
        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        if(providerRequiresKey(provider) && !apiKey){ setStatus('Please enter an API key first.', true); return; }
        if(provider === 'lmstudio' && endpointInput && !endpointInput.value.trim()){
          setStatus('Please enter LM Studio IP / Base URL.', true);
          return;
        }
        setStatus('Connecting…');
        setLoading(true);
        try{
          const models = await fetchModels(provider, apiKey);
          populateModels(models);
          const cfg = loadConfig();
          cfg.provider = provider;
          cfg.api_key = apiKey;
          if(endpointInput){ cfg.endpoint = endpointInput.value.trim(); }
          if(modelsSelect && modelsSelect.value){
            cfg.model = modelsSelect.value; // auto-save currently selected model
          }
          saveConfig(cfg);
          setStatus('Connected. Models loaded.');
        }catch(err){
          console.error(err);
          setStatus(err && err.message ? String(err.message) : 'Connect failed.', true);
        }finally{
          setLoading(false);
        }
      });
    }

    if(modelsSelect){
      modelsSelect.addEventListener('change', ()=>{
        const cfg = loadConfig();
        cfg.model = modelsSelect.value || '';
        saveConfig(cfg);
      });
    }
    // Persist slider changes automatically
    const autoSaveSliders = ()=>{
      const cfg = loadConfig();
      if(tempSlider) cfg.temperature = parseFloat(tempSlider.value);
      if(topPSlider) cfg.top_p = parseFloat(topPSlider.value);
      if(maxTokensSlider) cfg.max_tokens = parseInt(maxTokensSlider.value, 10);
      saveConfig(cfg);
      window.dispatchEvent(new CustomEvent('maid-chan:llm-config-updated', { detail: { config: cfg } }));
    };

    if(tempSlider){ tempSlider.addEventListener('change', autoSaveSliders); }
    if(topPSlider){ topPSlider.addEventListener('change', autoSaveSliders); }
    if(maxTokensSlider){ maxTokensSlider.addEventListener('change', autoSaveSliders); }

    // Restore slider labels initially
    updateSliderLabels();
  }

  window.Yuuka = window.Yuuka || {};
  window.Yuuka.components = window.Yuuka.components || {};
  window.Yuuka.components.MaidChanLLMSettings = { init };
})();
