class ChatComponent {
    constructor(container, api, activePlugins) {
        this.container = container;
        this.api = api;
        this.activePlugins = activePlugins;

        this.state = {
            currentTab: 'home', // home, chat_list, user_persona, creation, chat, settings, scenario, scene_edit, rule_edit
            personas: { characters: {}, users: {} },
            favorites: [],
            chatSessions: {},
            charactersInfo: {}, // Maps char_hash -> info from core
            activeUserPersonaId: null,
            activeChatSession: null,
            activeChatCharacterHash: null,
            editingPersona: null, // Temp state used during creation
            isStreaming: false,
            currentAbortController: null,
            currentTheme: 'yuuka', // yuuka (default) | modern
            scenarios: null, // { scenes: {}, rules: {} }
            scenarioTab: 'scene', // scene | rule
            editingScene: null,
            editingRule: null,
            pendingActions: [], // Pending user actions (gift, duo) waiting to be sent with next message
        };

        this._dockHandle = null; // navibar dock handle

        this.initDOM();
        this.bindEvents();
    }

    initDOM() {
        this.container.innerHTML = `
            <div id="chat-app" class="chat-app-container theme-yuuka">
                <!-- Views -->
                <div class="chat-view-container">
                    
                    <!-- Home View -->
                    <div id="view-home" class="chat-view active">
                        <header class="chat-header">
                            <h2>Companion</h2>
                            <div class="header-actions">
                                <button class="icon-btn action-btn" id="btn-create-character" title="Create Character">
                                    <span class="material-symbols-outlined">add</span>
                                </button>
                                <button class="icon-btn action-btn btn-search-toggle" title="Search">
                                    <span class="material-symbols-outlined">search</span>
                                </button>
                                <input type="text" class="header-search-input" placeholder="Search..." style="display: none; flex: 1; border: none; outline: none; background: transparent; font-size: 1rem; color: var(--chat-text); min-width: 0;">
                                <div class="header-nav-btns">
                                    <button class="chat-nav-btn active" data-tab="home">
                                        <span class="material-symbols-outlined">home</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="chat_list">
                                        <span class="material-symbols-outlined">chat</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="user_persona">
                                        <span class="material-symbols-outlined">person</span>
                                    </button>
                                    <button class="chat-nav-btn btn-open-scenario" data-tab="scenario">
                                        <span class="material-symbols-outlined">globe_book</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="settings">
                                        <span class="material-symbols-outlined">settings</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        <main class="chat-main" id="grid-home">
                            <!-- Character cards injected here -->
                        </main>
                    </div>

                    <!-- Chat List View -->
                    <div id="view-chat_list" class="chat-view hidden">
                        <header class="chat-header">
                            <h2>Chat List</h2>
                            <div class="header-actions">
                                <button class="icon-btn action-btn btn-search-toggle" title="Search">
                                    <span class="material-symbols-outlined">search</span>
                                </button>
                                <input type="text" class="header-search-input" placeholder="Search..." style="display: none; flex: 1; border: none; outline: none; background: transparent; font-size: 1rem; color: var(--chat-text); min-width: 0;">
                                <div class="header-nav-btns">
                                    <button class="chat-nav-btn" data-tab="home">
                                        <span class="material-symbols-outlined">home</span>
                                    </button>
                                    <button class="chat-nav-btn active" data-tab="chat_list">
                                        <span class="material-symbols-outlined">chat</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="user_persona">
                                        <span class="material-symbols-outlined">person</span>
                                    </button>
                                    <button class="chat-nav-btn btn-open-scenario" data-tab="scenario">
                                        <span class="material-symbols-outlined">globe_book</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="settings">
                                        <span class="material-symbols-outlined">settings</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        <main class="chat-main" id="grid-chat_list">
                        </main>
                    </div>

                    <!-- User Persona View -->
                    <div id="view-user_persona" class="chat-view hidden">
                        <header class="chat-header">
                            <h2>User Persona</h2>
                            <div class="header-actions">
                                <button class="icon-btn action-btn" id="btn-create-user-persona" title="Create Persona">
                                    <span class="material-symbols-outlined">add</span>
                                </button>
                                <button class="icon-btn action-btn btn-search-toggle" title="Search">
                                    <span class="material-symbols-outlined">search</span>
                                </button>
                                <input type="text" class="header-search-input" placeholder="Search..." style="display: none; flex: 1; border: none; outline: none; background: transparent; font-size: 1rem; color: var(--chat-text); min-width: 0;">
                                <div class="header-nav-btns">
                                    <button class="chat-nav-btn" data-tab="home">
                                        <span class="material-symbols-outlined">home</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="chat_list">
                                        <span class="material-symbols-outlined">chat</span>
                                    </button>
                                    <button class="chat-nav-btn active" data-tab="user_persona">
                                        <span class="material-symbols-outlined">person</span>
                                    </button>
                                    <button class="chat-nav-btn btn-open-scenario" data-tab="scenario">
                                        <span class="material-symbols-outlined">globe_book</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="settings">
                                        <span class="material-symbols-outlined">settings</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        <main class="chat-main" id="grid-user_persona">
                        </main>
                    </div>

                    <!-- Settings View -->
                    <div id="view-settings" class="chat-view hidden">
                        <header class="chat-header">
                            <h2>Settings</h2>
                            <div class="header-actions">
                                <button class="icon-btn action-btn btn-search-toggle" title="Search">
                                    <span class="material-symbols-outlined">search</span>
                                </button>
                                <input type="text" class="header-search-input" placeholder="Search..." style="display: none; flex: 1; border: none; outline: none; background: transparent; font-size: 1rem; color: var(--chat-text); min-width: 0;">
                                <div class="header-nav-btns">
                                    <button class="chat-nav-btn" data-tab="home">
                                        <span class="material-symbols-outlined">home</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="chat_list">
                                        <span class="material-symbols-outlined">chat</span>
                                    </button>
                                    <button class="chat-nav-btn" data-tab="user_persona">
                                        <span class="material-symbols-outlined">person</span>
                                    </button>
                                    <button class="chat-nav-btn btn-open-scenario" data-tab="scenario">
                                        <span class="material-symbols-outlined">globe_book</span>
                                    </button>
                                    <button class="chat-nav-btn active" data-tab="settings">
                                        <span class="material-symbols-outlined">settings</span>
                                    </button>
                                </div>
                            </div>
                        </header>
                        <main class="chat-main">
                            <div class="settings-group">
                                <h3>Chat</h3>
                                <div class="settings-toggle">
                                    <label for="chat-auto-line-break">Automatic line break (dialogue separation)</label>
                                    <label class="switch">
                                        <input type="checkbox" id="chat-auto-line-break" checked>
                                        <span class="slider"></span>
                                    </label>
                                </div>
                            </div>

                            <div class="settings-group">
                                <h3>LLM</h3>
                                <div class="form-group" style="margin-bottom: 1rem;">
                                    <label>Model</label>
                                    <div style="position: relative; margin-top: 0.5rem;">
                                        <select id="chat-llm-model">
                                            <option value="">Default (Provider Default)</option>
                                        </select>
                                        <span class="material-symbols-outlined" style="position: absolute; right: 10px; top: 10px; pointer-events: none; color: var(--chat-text-secondary);">expand_more</span>
                                    </div>
                                </div>
                                <div class="form-group" style="margin-bottom: 1rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <label>Temperature</label>
                                        <span id="chat-llm-temperature-val" style="font-size: 0.9em; font-weight: bold; color: var(--color-accent);">Default</span>
                                    </div>
                                    <input type="range" id="chat-llm-temperature" min="0" max="11" step="1" value="0" style="margin-top: 0.5rem; width: 100%; cursor: pointer;">
                                    <div style="position: relative; height: 1.2em; font-size: 0.8em; color: var(--chat-text-secondary); margin-top: 4px;">
                                        <span style="position: absolute; left: 0;">Default</span>
                                        <span style="position: absolute; left: 54.54%; transform: translateX(-50%);">1.0</span>
                                        <span style="position: absolute; right: 0;">1.5</span>
                                    </div>
                                </div>

                            </div>

                            <div class="settings-group">
                                <h3>Image Generation</h3>
                                
                                <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
                                    <button id="btn-open-emotion-editor" class="text-btn save-btn" style="padding: 6px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">Emotion Editor</button>
                                    
                                    <button id="btn-open-action-editor" class="text-btn save-btn" style="padding: 6px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">Action Editor</button>
                                </div>
                                
                                <div class="form-group" style="margin-bottom: 1rem;">
                                    <label>Generated Image View Mode</label>
                                    <div style="position: relative;">
                                        <select id="chat-image-gen-view-mode">
                                            <option value="bubble">Show in chat bubble only (Default)</option>
                                            <option value="bg">Show as chat background only</option>
                                            <option value="both">Show in both bubble and background</option>
                                        </select>
                                        <span class="material-symbols-outlined" style="position: absolute; right: 10px; top: 10px; pointer-events: none; color: var(--chat-text-secondary);">expand_more</span>
                                    </div>
                                </div>

                                <div class="settings-toggle">
                                    <label for="chat-image-gen-every-message">Every message (Auto generate after each bot reply)</label>
                                    <label class="switch">
                                        <input type="checkbox" id="chat-image-gen-every-message">
                                        <span class="slider"></span>
                                    </label>
                                </div>

                                <div class="settings-toggle">
                                    <label for="chat-image-gen-use-quality">Use quality tags (from album default)</label>
                                    <label class="switch">
                                        <input type="checkbox" id="chat-image-gen-use-quality" checked>
                                        <span class="slider"></span>
                                    </label>
                                </div>

                                <div class="settings-toggle">
                                    <label for="chat-image-gen-use-negative">Use negative tags (from album default)</label>
                                    <label class="switch">
                                        <input type="checkbox" id="chat-image-gen-use-negative" checked>
                                        <span class="slider"></span>
                                    </label>
                                </div>

                                <div class="form-group" style="margin-top: 1rem;">
                                    <label>Non-outfits tags (used when character wears nothing)</label>
                                    <input type="text" id="chat-image-gen-non-outfits" placeholder="e.g. naked, nude..." value="">
                                </div>

                                <div class="form-group" style="margin-top: 1rem;">
                                    <label>Additional tags (appended to all generations)</label>
                                    <input type="text" id="chat-image-gen-additional-tags" placeholder="e.g. solo, solo focus, 1girl..." value="">
                                </div>

                                <div class="form-group" style="margin-top: 1rem;">
                                    <label>Checkpoint</label>
                                    <div style="position: relative;">
                                        <select id="chat-image-gen-ckpt_name">
                                            <option value="">Default (From album config)</option>
                                        </select>
                                        <span class="material-symbols-outlined" style="position: absolute; right: 10px; top: 10px; pointer-events: none; color: var(--chat-text-secondary);">expand_more</span>
                                    </div>
                                </div>
                            </div>

                            <div class="settings-group">
                                <h3>Theme</h3>
                                <div class="theme-cards" id="theme-cards">
                                    <!-- Theme cards injected here -->
                                </div>

                                <div class="theme-customization" style="margin-top: 1.5rem;">
                                    <h4 style="font-size: 0.95rem; font-weight: 600; margin: 0 0 0.75rem 0; color: var(--chat-text-secondary);">Text</h4>

                                    <div class="form-group" style="margin-bottom: 1rem;">
                                        <label>Font</label>
                                        <div style="position: relative; margin-top: 0.5rem;">
                                            <select id="chat-theme-font">
                                                <option value="">System Default</option>
                                                <option value="'Segoe UI', Tahoma, sans-serif">Segoe UI</option>
                                                <option value="Georgia, 'Times New Roman', serif">Georgia (Serif)</option>
                                                <option value="'Courier New', Consolas, monospace">Courier New</option>
                                                <option value="'Comic Sans MS', cursive">Comic Sans</option>
                                            </select>
                                            <span class="material-symbols-outlined" style="position: absolute; right: 10px; top: 10px; pointer-events: none; color: var(--chat-text-secondary);">expand_more</span>
                                        </div>
                                    </div>

                                    <div class="form-group" style="margin-bottom: 1rem;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <label>Size</label>
                                            <span id="chat-theme-font-size-val" style="font-size: 0.9em; font-weight: bold; color: var(--chat-primary);">15px</span>
                                        </div>
                                        <input type="range" id="chat-theme-font-size" min="0" max="8" step="1" value="3" style="margin-top: 0.5rem; width: 100%; cursor: pointer;">
                                        <div style="position: relative; height: 1.2em; font-size: 0.8em; color: var(--chat-text-secondary); margin-top: 4px;">
                                            <span style="position: absolute; left: 0;">12px</span>
                                            <span style="position: absolute; left: 50%; transform: translateX(-50%);">16px</span>
                                            <span style="position: absolute; right: 0;">20px</span>
                                        </div>
                                    </div>

                                    <div class="form-group" style="margin-bottom: 1rem;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <label>Line Space</label>
                                            <span id="chat-theme-line-space-val" style="font-size: 0.9em; font-weight: bold; color: var(--chat-primary);">1.6</span>
                                        </div>
                                        <input type="range" id="chat-theme-line-space" min="0" max="6" step="1" value="2" style="margin-top: 0.5rem; width: 100%; cursor: pointer;">
                                        <div style="position: relative; height: 1.2em; font-size: 0.8em; color: var(--chat-text-secondary); margin-top: 4px;">
                                            <span style="position: absolute; left: 0;">1.2</span>
                                            <span style="position: absolute; left: 50%; transform: translateX(-50%);">1.8</span>
                                            <span style="position: absolute; right: 0;">2.4</span>
                                        </div>
                                    </div>

                                    <div class="form-group" style="margin-bottom: 1.5rem;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <label>Color</label>
                                            <div style="display: flex; align-items: center; gap: 8px;">
                                                <button id="chat-theme-text-color-reset" class="icon-btn" style="padding: 2px; opacity: 0.6;" title="Reset to default">
                                                    <span class="material-symbols-outlined" style="font-size: 18px;">restart_alt</span>
                                                </button>
                                                <input type="color" id="chat-theme-text-color" value="#ffffff" style="width: 32px; height: 32px; padding: 0; border: 2px solid var(--chat-border); border-radius: 8px; cursor: pointer; background: transparent;">
                                            </div>
                                        </div>
                                    </div>

                                    <h4 style="font-size: 0.95rem; font-weight: 600; margin: 0 0 0.75rem 0; color: var(--chat-text-secondary);">Bubble Chat</h4>

                                    <div class="form-group" style="margin-bottom: 1rem;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <label>Opacity</label>
                                            <span id="chat-theme-bubble-opacity-val" style="font-size: 0.9em; font-weight: bold; color: var(--chat-primary);">25%</span>
                                        </div>
                                        <input type="range" id="chat-theme-bubble-opacity" min="0" max="10" step="1" value="4" style="margin-top: 0.5rem; width: 100%; cursor: pointer;">
                                        <div style="position: relative; height: 1.2em; font-size: 0.8em; color: var(--chat-text-secondary); margin-top: 4px;">
                                            <span style="position: absolute; left: 0;">5%</span>
                                            <span style="position: absolute; left: 50%; transform: translateX(-50%);">30%</span>
                                            <span style="position: absolute; right: 0;">100%</span>
                                        </div>
                                    </div>

                                    <div class="settings-toggle">
                                        <label for="chat-theme-bubble-blur">Blur (Background mode only)</label>
                                        <label class="switch">
                                            <input type="checkbox" id="chat-theme-bubble-blur" checked>
                                            <span class="slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </main>
                    </div>

                    <!-- Creation View -->
                    <div id="view-creation" class="chat-view hidden overlay-view">
                        <header class="chat-header has-back">
                            <button class="icon-btn back-btn" data-back="true">
                                <span class="material-symbols-outlined">arrow_back</span>
                            </button>
                            <h2 id="creation-title">New Persona</h2>
                            <div class="creation-actions" style="margin-left: auto; display: flex; gap: 1rem;">
                                <button class="text-btn delete-btn" id="btn-delete-persona" style="display: none; color: var(--chat-danger, #e05252);">
                                    <span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">delete</span> Delete
                                </button>
                                <button class="text-btn ai-gen-btn" id="btn-ai-gen-persona">
                                    <span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">auto_awesome</span> Generate
                                </button>
                                <button class="text-btn save-btn" id="btn-save-creation">Save</button>
                            </div>
                        </header>
                        <main class="chat-main form-main">
                            <div class="avatar-section">
                                <div class="avatar-preview" id="creation-avatar" style="background-image: url(''); cursor: pointer;" title="Nhấn để tải ảnh lên">
                                    <span class="material-symbols-outlined">photo_camera</span>
                                </div>
                                <input type="file" id="creation-avatar-input" accept="image/*" style="display: none;">
                            </div>
                            
                            <div class="form-group">
                                <label>Name</label>
                                <input type="text" id="creation-name" placeholder="Enter name...">
                            </div>
                            
                            <div class="form-group" id="group-appearance" style="display: none;">
                                <label>Appearance (Booru Tags, comma separated)</label>
                                <input type="text" id="creation-appearance" placeholder="1girl, long hair, blue eyes...">
                            </div>
                            
                            <div class="form-group" id="group-outfits" style="display: none;">
                                <label>Default Outfits (Booru Tags, comma separated)</label>
                                <input type="text" id="creation-outfits" placeholder="school uniform, blazer...">
                            </div>
                            
                            <div class="form-group">
                                <label>Persona</label>
                                <textarea id="creation-persona" placeholder="Describe the personality, backstory, etc..." rows="5"></textarea>
                            </div>
                            
                            <div class="form-group" id="group-chat-sample">
                                <label>Chat Sample</label>
                                <textarea id="creation-chat-sample" placeholder="Example dialouges..." rows="4"></textarea>
                            </div>
                        </main>
                    </div>

                    <!-- Scenario View -->
                    <div id="view-scenario" class="chat-view hidden overlay-view">
                        <header class="chat-header has-back">
                            <button class="icon-btn back-btn" data-back="true">
                                <span class="material-symbols-outlined">arrow_back</span>
                            </button>
                            <div class="scenario-tabs-header">
                                <button class="scenario-tab-btn active" data-tab="scene">Scene</button>
                                <button class="scenario-tab-btn" data-tab="rule">Rule</button>
                            </div>
                            <div style="margin-left: auto; display: flex; gap: 0.5rem;">
                                <button class="icon-btn" id="btn-scenario-add" title="Add">
                                    <span class="material-symbols-outlined">add</span>
                                </button>
                            </div>
                        </header>
                        <main class="chat-main" id="scenario-cards-container">
                        </main>
                    </div>

                    <!-- Scene Edit View -->
                    <div id="view-scene_edit" class="chat-view hidden overlay-view">
                        <header class="chat-header has-back">
                            <button class="icon-btn back-btn" data-back="true">
                                <span class="material-symbols-outlined">arrow_back</span>
                            </button>
                            <h2 id="scene-edit-title">New Scene</h2>
                            <div style="margin-left: auto; display: flex; gap: 1rem;">
                                <button class="text-btn ai-gen-btn" id="btn-scene-generate">
                                    <span class="material-symbols-outlined" style="font-size: 1.1rem; vertical-align: middle;">auto_awesome</span> Generate
                                </button>
                                <button class="text-btn save-btn" id="btn-save-scene">Save</button>
                            </div>
                        </header>
                        <main class="chat-main form-main">
                            <div class="avatar-section">
                                <div class="avatar-preview scene-cover-preview" id="scene-edit-cover" title="Tap to upload cover">
                                    <span class="material-symbols-outlined">landscape</span>
                                </div>
                                <input type="file" id="scene-edit-cover-input" accept="image/*" style="display: none;">
                            </div>
                            <div class="form-group">
                                <label>Name</label>
                                <input type="text" id="scene-edit-name" placeholder="Scene name...">
                            </div>
                            <div class="form-group" style="position: relative;">
                                <label>Context <span style="font-size: 0.8em; color: var(--chat-text-secondary);">(Use @ to tag characters, users, or rules)</span></label>
                                <textarea id="scene-edit-context" placeholder="Describe the scene... Use @name to reference characters, users, or rules." rows="8"></textarea>
                                <div id="tag-autocomplete-dropdown" class="tag-autocomplete-dropdown hidden"></div>
                            </div>
                        </main>
                    </div>

                    <!-- Rule Edit View -->
                    <div id="view-rule_edit" class="chat-view hidden overlay-view">
                        <header class="chat-header has-back">
                            <button class="icon-btn back-btn" data-back="true">
                                <span class="material-symbols-outlined">arrow_back</span>
                            </button>
                            <h2 id="rule-edit-title">New Rule</h2>
                            <div style="margin-left: auto; display: flex; gap: 0.5rem;">
                                <button class="text-btn" id="btn-clone-rule" style="display: none; color: var(--chat-text-secondary);">Clone</button>
                                <button class="text-btn save-btn" id="btn-save-rule">Save</button>
                            </div>
                        </header>
                        <main class="chat-main form-main">
                            <div class="form-group">
                                <label>Name</label>
                                <input type="text" id="rule-edit-name" placeholder="Rule name...">
                            </div>
                            <div class="form-group" id="rule-apply-to-group" style="display: none;">
                                <label>Apply to</label>
                                <select id="rule-edit-apply-to" class="form-select">
                                    <option value="">Select one</option>
                                    <option value="chat_system">Chat System</option>
                                    <option value="first_message">First message</option>
                                    <option value="world_builder">World builder</option>
                                    <option value="event">Event</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>System Instruction</label>
                                <textarea id="rule-edit-content" placeholder="Write the system instruction..." rows="10"></textarea>
                            </div>
                        </main>
                    </div>

                    <!-- Chat Interface View -->
                    <div id="view-chat" class="chat-view hidden overlay-view">
                        <header class="chat-header has-back">
                            <button class="icon-btn back-btn" data-back="true">
                                <span class="material-symbols-outlined">arrow_back</span>
                            </button>
                            <div class="chat-header-profile">
                                <img src="" alt="Avatar" id="chat-header-avatar">
                                <div class="chat-header-info">
                                    <h2 id="chat-header-name">Name</h2>
                                    <div id="chat-header-mood" class="chat-mood-indicator" style="display: none; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                                        <!-- Emotion tags injected here dynamically -->
                                    </div>
                                </div>
                            </div>
                            <div class="chat-header-actions" style="margin-left: auto; display: flex; gap: 0.5rem;">
                                <button class="icon-btn" id="btn-chat-inventory" title="Character Status">
                                    <span class="material-symbols-outlined">person_heart</span>
                                </button>
                                <button class="icon-btn" id="btn-edit-active-character" title="Edit Persona">
                                    <span class="material-symbols-outlined">edit</span>
                                </button>
                            </div>
                        </header>
                        <div id="chat-view-bg" class="chat-view-bg-container"></div>
                        <main class="chat-main chat-messages" id="chat-messages-container">
                            <!-- Bubbles -->
                        </main>
                        <!-- No footer here — input is rendered via navibar dock -->
                    </div>

                    <!-- Inventory Panel (slide-in from right) -->
                    <div id="modal-inventory" class="inventory-panel hidden">
                        <div class="inventory-panel-resize-handle" id="inventory-resize-handle"></div>
                        <div class="chat-modal-content">
                            <div class="status-modal-tabs">
                                <button class="status-tab-btn active" data-tab="status">Status</button>
                                <button class="status-tab-btn" data-tab="memory">Memory</button>
                                <button class="status-tab-btn" data-tab="scenes">Scene</button>
                                <button class="status-tab-btn" data-tab="album">Album</button>
                                <button class="icon-btn close-modal-btn inventory-close-btn" data-modal="modal-inventory">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                            </div>
                            <div class="chat-modal-body inventory-body" id="status-tab-status">
                                <div id="inventory-member-section" class="inventory-member-section"></div>
                                <div id="inventory-char-status-wrap">
                                    <div class="inventory-section status-section">
                                        <div class="inventory-location-row">
                                            <div>
                                                <h3 style="margin: 0;">Location</h3>
                                                <div id="inventory-location-label" class="location-label">Unknown</div>
                                            </div>
                                            <span id="inventory-stamina-label" style="font-size: 0.9em; color: var(--chat-primary); font-weight: 600;">⚡ 100</span>
                                        </div>
                                    </div>
                                    <div class="inventory-section status-section">
                                        <h3>Emotions</h3>
                                        <div id="inventory-emotion-list" class="emotion-list"></div>
                                    </div>
                                    <div class="inventory-section status-section">
                                        <h3>Actions</h3>
                                        <div id="inventory-action-list" class="emotion-list"></div>
                                    </div>
                                    <div class="inventory-section">
                                        <h3>Outfits Slot (Currently Worn)</h3>
                                        <div id="inventory-outfits-slot" class="inventory-slot has-dropzone" data-slot-type="outfit"></div>
                                    </div>
                                    <div class="inventory-section">
                                        <h3>Bag / Inventory</h3>
                                        <div id="inventory-bag-slot" class="inventory-slot has-dropzone" data-slot-type="bag"></div>
                                    </div>
                                    <p class="inventory-hint">Drag and drop items between Bag and Outfits to change clothes.</p>
                                </div>
                            </div>
                            <div class="chat-modal-body" id="status-tab-memory" style="display: none;">
                                <div class="inventory-section" style="display: flex; flex-direction: column; flex: 1; margin-bottom: 0;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <input id="memory-name-input" placeholder="Memory Summary" style="margin: 0; font-size: 1em; font-weight: 600; color: var(--chat-text); background: transparent; border: none; outline: none; flex: 1; min-width: 0; cursor: text; font-family: inherit;">
                                        <div style="display: flex; gap: 4px; flex-shrink: 0;">
                                            <button id="btn-memory-summarize" style="padding: 6px 16px; font-size: 0.85em; border: 1px solid var(--chat-border); border-radius: 6px; background: var(--chat-panel-bg); color: var(--chat-text); cursor: pointer; white-space: nowrap; font-family: inherit;">Summarize</button>
                                            <button id="btn-memory-save-scene" title="Save as Scene" style="padding: 6px 8px; font-size: 0.85em; border: 1px solid var(--chat-border); border-radius: 6px; background: var(--chat-panel-bg); color: var(--chat-text); cursor: pointer; display: flex; align-items: center;"><span class="material-symbols-outlined" style="font-size: 18px;">save</span></button>
                                            <button id="btn-memory-clear" title="Clear memory" style="padding: 6px 8px; font-size: 0.85em; border: 1px solid var(--chat-border); border-radius: 6px; background: var(--chat-panel-bg); color: var(--chat-text); cursor: pointer; display: flex; align-items: center;"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
                                        </div>
                                    </div>
                                    <textarea id="memory-summary-textarea" placeholder="No memory summary yet. Click 'Summarize' to generate one from chat history." style="width: 100%; min-height: 80px; padding: 12px; border-radius: 8px; border: 1px solid var(--chat-border); background: var(--chat-panel-bg); color: var(--chat-text); font-family: inherit; font-size: 0.9em; line-height: 1.5; resize: none; box-sizing: border-box; overflow: hidden;"></textarea>
                                    <p class="inventory-hint" style="margin-top: 8px;">This summary is used as long-term context for the AI. Edits are auto-saved.</p>
                                </div>
                            </div>
                            <div class="chat-modal-body" id="status-tab-scenes" style="display: none;">
                                <div class="inventory-section" style="display: flex; flex-direction: column; flex: 1; margin-bottom: 0;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <h3 style="margin: 0;">Active Scenes</h3>
                                        <button id="btn-add-scene-to-chat" style="padding: 6px 16px; font-size: 0.85em; border: 1px solid var(--chat-border); border-radius: 6px; background: var(--chat-panel-bg); color: var(--chat-text); cursor: pointer; white-space: nowrap; font-family: inherit;">+ Add</button>
                                    </div>
                                    <div id="active-scenes-list" class="active-scenes-list"></div>
                                    <p class="inventory-hint" style="margin-top: 8px;">Add up to 3 scenes. Active scenes provide context for the AI.</p>
                                </div>
                            </div>
                            <div class="chat-modal-body" id="status-tab-album" style="display: none; padding: 0.5rem;">
                                <div id="inventory-album-grid" class="inventory-album-grid"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Scene Picker Modal -->
                    <div id="modal-scene-picker" class="chat-modal hidden">
                        <div class="chat-modal-content">
                            <header class="chat-modal-header">
                                <h2>Select Scene</h2>
                                <button class="icon-btn close-modal-btn" data-modal="modal-scene-picker">
                                    <span class="material-symbols-outlined">close</span>
                                </button>
                            </header>
                            <div class="chat-modal-body" style="display: flex; flex-direction: column; gap: 12px;">
                                <div class="form-group" style="margin-bottom: 0;">
                                    <input type="text" id="scene-picker-search" placeholder="Search scenes..." style="width: 100%;">
                                </div>
                                <div id="scene-picker-list" class="inventory-section" style="max-height: 50vh; overflow-y: auto; margin-bottom: 0;">
                                    <!-- Scenes will be listed here -->
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;
    }

    bindEvents() {
        // Navigation Tabs (in headers)
        this.container.querySelectorAll('.chat-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tab = e.currentTarget.dataset.tab;
                if (tab === 'scenario') {
                    this.openScenario();
                } else {
                    this.switchTab(tab);
                }
            });
        });

        // Scenario events
        this.container.querySelectorAll('.scenario-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this._handleScenarioTabSwitch(btn.dataset.tab));
        });

        const btnScenarioAdd = this.container.querySelector('#btn-scenario-add');
        if (btnScenarioAdd) btnScenarioAdd.addEventListener('click', () => this._handleScenarioAdd());

        // Scene Edit events
        const btnSceneGen = this.container.querySelector('#btn-scene-generate');
        if (btnSceneGen) btnSceneGen.addEventListener('click', () => this.handleSceneGenerate());

        const btnSaveScene = this.container.querySelector('#btn-save-scene');
        if (btnSaveScene) btnSaveScene.addEventListener('click', () => this.handleSaveScene());

        // Scene cover upload
        const sceneCover = this.container.querySelector('#scene-edit-cover');
        const sceneCoverInput = this.container.querySelector('#scene-edit-cover-input');
        if (sceneCover && sceneCoverInput) {
            sceneCover.addEventListener('click', () => sceneCoverInput.click());
            sceneCoverInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        sceneCover.style.backgroundImage = `url('${ev.target.result}')`;
                        if (this.state.editingScene) {
                            this.state.editingScene.coverBase64 = ev.target.result;
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        // Rule Edit events
        const btnSaveRule = this.container.querySelector('#btn-save-rule');
        if (btnSaveRule) btnSaveRule.addEventListener('click', () => this.handleSaveRule());



        // Back Buttons
        this.container.querySelectorAll('.back-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                // Scene/Rule edit: return to scenario or chat
                if (this.state.currentTab === 'scene_edit') {
                    this.switchTab(this.state.editingScene?.fromChat ? 'chat' : 'scenario');
                    return;
                }
                if (this.state.currentTab === 'rule_edit') {
                    this.switchTab('scenario');
                    return;
                }
                // If editing a group chat, return to chat view
                if (this.state.currentTab === 'creation'
                    && this.state.editingGroupSession?.editingGroupId) {
                    this.switchTab('chat');
                    if (this.state.activeChatGroupSession) {
                        this._renderCharacterBar && this._renderCharacterBar(this.state.activeChatGroupSession);
                    }
                // If editing a character that belongs to an active chat, return to chat view
                } else if (this.state.currentTab === 'creation'
                    && this.state.editingPersona?.type === 'characters'
                    && this.state.editingPersona?.id
                    && this.state.activeChatCharacterHash === this.state.editingPersona.id) {
                    this.switchTab('chat');
                } else {
                    this.switchTab(this.state.previousTab || 'home');
                }
            });
        });

        // Generate with AI
        this.container.querySelector('#btn-ai-gen-persona').addEventListener('click', this.handleAIGeneratePersona.bind(this));

        // Delete Persona
        this.container.querySelector('#btn-delete-persona').addEventListener('click', this.handleDeletePersona.bind(this));

        // Save Persona
        this.container.querySelector('#btn-save-creation').addEventListener('click', this.handleSaveCreation.bind(this));

        // Create buttons
        this.container.querySelector('#btn-create-character').addEventListener('click', () => this.openCreation('characters'));
        this.container.querySelector('#btn-create-user-persona').addEventListener('click', () => this.openCreation('users'));

        // Avatar upload
        const avatarPreview = this.container.querySelector('#creation-avatar');
        const avatarInput = this.container.querySelector('#creation-avatar-input');
        if (avatarPreview && avatarInput) {
            avatarPreview.addEventListener('click', () => avatarInput.click());
            avatarInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        avatarPreview.style.backgroundImage = `url('${ev.target.result}')`;
                        if (this.state.editingPersona) {
                            this.state.editingPersona.avatarBase64 = ev.target.result;
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        // Auto-grow textareas
        const setupAutoGrow = (id) => {
            const el = this.container.querySelector(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = (e.target.scrollHeight) + 'px';
                });
            }
        };
        setupAutoGrow('#creation-persona');
        setupAutoGrow('#creation-chat-sample');
        setupAutoGrow('#scene-edit-context');
        setupAutoGrow('#rule-edit-content');

        // Scroll listener for chat background effects
        const chatMessages = this.container.querySelector('#chat-messages-container');
        if (chatMessages) {
            chatMessages.addEventListener('scroll', () => {
                const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 150;
                const chatView = this.container.querySelector('#view-chat');
                if (chatView) {
                    if (isNearBottom) {
                        chatView.classList.remove('viewing-history');
                        chatView.classList.add('viewing-latest');
                        // Re-show scroll-up hint when back at bottom
                        if (chatView.classList.contains('has-bg-image')) {
                            const hint = chatMessages.querySelector('.chat-scroll-up-hint');
                            if (hint) hint.classList.add('visible');
                        }
                    } else {
                        chatView.classList.remove('viewing-latest');
                        chatView.classList.add('viewing-history');
                        // Hide scroll-up hint when user scrolls up
                        const hint = chatMessages.querySelector('.chat-scroll-up-hint');
                        if (hint) hint.classList.remove('visible');
                    }
                }
            });
        }

        const btnEmotion = this.container.querySelector('#btn-open-emotion-editor');
        if (btnEmotion) {
            btnEmotion.addEventListener('click', () => {
                if (window.EmotionEditor && this.emotionEngine) {
                    new window.EmotionEditor(this.emotionEngine).open();
                } else {
                    alert("Emotion Engine not fully loaded yet.");
                }
            });
        }

        const btnAction = this.container.querySelector('#btn-open-action-editor');
        if (btnAction) {
            btnAction.addEventListener('click', () => {
                if (window.ActionEditor && this.actionEngine) {
                    new window.ActionEditor(this.actionEngine).open();
                } else {
                    alert("Action Engine not fully loaded yet.");
                }
            });
        }

        // Search logic
        this.container.querySelectorAll('.btn-search-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const headerActions = btn.closest('.header-actions');
                const input = headerActions.querySelector('.header-search-input');
                Array.from(headerActions.children).forEach(child => {
                    if (child !== input) child.style.display = 'none';
                });
                headerActions.style.flex = '1';
                headerActions.style.marginLeft = '1rem';
                input.style.display = 'block';
                input.focus();
            });
        });

        this.container.querySelectorAll('.header-search-input').forEach(input => {
            input.addEventListener('blur', (e) => {
                setTimeout(() => {
                    // Check if input is still in the DOM and if we really blurred outside
                    const headerActions = input.closest('.header-actions');
                    if (!headerActions) return;
                    Array.from(headerActions.children).forEach(child => {
                        if (child !== input) child.style.display = '';
                    });
                    headerActions.style.flex = '';
                    headerActions.style.marginLeft = 'auto';
                    input.style.display = 'none';
                    if (input.value !== '') {
                        input.value = '';
                        this.handleSearch('');
                    }
                }, 150);
            });

            input.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        });
    }

    handleSearch(query) {
        query = query.toLowerCase();

        if (this.state.currentTab === 'settings') {
            const groups = this.container.querySelectorAll('#view-settings .settings-group');
            groups.forEach(group => {
                if (group.textContent.toLowerCase().includes(query)) {
                    group.style.display = '';
                } else {
                    group.style.display = 'none';
                }
            });
            return;
        }

        let cards;
        if (this.state.currentTab === 'home') {
            cards = this.container.querySelectorAll('#grid-home .yuuka-home-card');
        } else if (this.state.currentTab === 'chat_list') {
            cards = this.container.querySelectorAll('#grid-chat_list .chat-card');
        } else if (this.state.currentTab === 'user_persona') {
            cards = this.container.querySelectorAll('#grid-user_persona .chat-card');
        }

        if (cards) {
            cards.forEach(card => {
                const nameEl = card.querySelector('.card-name');
                const name = nameEl ? nameEl.textContent.toLowerCase() : '';
                if (name.includes(query)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        }
    }

    async init() {
        console.log("[Plugin:Chat] Initializing frontend...");

        try { this._registerNavibarButtons(); } catch { }

        // Initialize Emotion Engine
        try {
            if (window.EmotionEngine) {
                this.emotionEngine = new window.EmotionEngine();
                await this.emotionEngine.loadRules();
                console.log("[Plugin:Chat] Emotion Engine initialized", this.emotionEngine.rules);
            }
        } catch (e) {
            console.error("[Plugin:Chat] Failed to init emotion engine:", e);
        }

        // Initialize Action Engine
        try {
            if (window.ActionEngine) {
                this.actionEngine = new window.ActionEngine();
                await this.actionEngine.loadRules();
                console.log("[Plugin:Chat] Action Engine initialized", this.actionEngine.rules);
            }
        } catch (e) {
            console.error("[Plugin:Chat] Failed to init action engine:", e);
        }

        // Listen for global image additions (from auto generation or direct calls)
        if (!this._imageListenerBound) {
            window.Yuuka.events.on('image:added', (data) => {
                if (typeof this.handleImageGeneratedEvent === 'function') {
                    this.handleImageGeneratedEvent(data);
                }
            });
            this._imageListenerBound = true;
        }

        await this.loadInitialData();

        if (window.Yuuka && window.Yuuka.initialPluginState && window.Yuuka.initialPluginState.chat && window.Yuuka.initialPluginState.chat.character) {
            const charToOpen = window.Yuuka.initialPluginState.chat.character;
            delete window.Yuuka.initialPluginState.chat;

            if (this.state.personas && this.state.personas.characters && this.state.personas.characters[charToOpen.hash]) {
                this.openChat(charToOpen.hash);
            } else {
                this.openCreation('characters', charToOpen.hash);
            }
        } else {
            this.renderHome();
        }

        this.renderUserPersona();
        this.renderThemeSettings();
        if (this.initSettings) this.initSettings();

        try { this._updateNav(); } catch { }
    }

    async loadInitialData() {
        try {
            // Load personas
            const resPersonas = await this.api['chat'].get('/personas');
            this.state.personas = resPersonas;

            // Load favorites from character list if available
            try {
                const resLists = await this.api['character-list'].get('/lists');
                this.state.favorites = resLists.favourites || [];
            } catch (e) {
                console.warn("Character-list plugin lists not available.", e);
            }

            // Get characters info from global cache
            if (window.Yuuka && window.Yuuka.services && window.Yuuka.services.api) {
                const resChars = await window.Yuuka.services.api.getAllCharacters();
                if (resChars && resChars.characters) {
                    resChars.characters.forEach(c => {
                        this.state.charactersInfo[c.hash] = c;
                    });
                }
            } else {
                const resChars = await this.api.getAllCharacters();
                if (resChars && resChars.characters) {
                    resChars.characters.forEach(c => {
                        this.state.charactersInfo[c.hash] = c;
                    });
                }
            }

            // Set default active user persona
            const userPersonas = Object.values(this.state.personas.users || {});
            if (userPersonas.length > 0) {
                this.state.activeUserPersonaId = userPersonas[0].id;
            }

            // Load saved theme
            try {
                const savedTheme = localStorage.getItem('chat-theme') || 'yuuka';
                this.state.currentTheme = savedTheme;
                this.applyTheme(savedTheme);
            } catch (e) { /* ignore */ }

        } catch (e) {
            console.error("Failed to load initial chat data", e);
        }
    }

    switchTab(tab) {
        const overlayTabs = ['creation', 'chat', 'scenario', 'scene_edit', 'rule_edit'];
        if (overlayTabs.includes(tab)) {
            if (!overlayTabs.includes(this.state.currentTab)) {
                this.state.previousTab = this.state.currentTab;
            }
        } else {
            // Update active nav button across all headers
            this.container.querySelectorAll('.chat-nav-btn').forEach(b => b.classList.remove('active'));
            this.container.querySelectorAll(`.chat-nav-btn[data-tab="${tab}"]`).forEach(btn => btn.classList.add('active'));
        }

        // Close inventory panel when leaving chat view
        if (tab !== 'chat') {
            const panel = this.container.querySelector('#modal-inventory');
            const chatView = this.container.querySelector('#view-chat');
            if (panel) panel.classList.add('hidden');
            if (chatView) chatView.classList.remove('inventory-open');
        }

        // Switch views
        const views = this.container.querySelectorAll('.chat-view');
        views.forEach(v => v.classList.remove('active', 'hidden'));
        views.forEach(v => {
            if (v.id === `view-${tab}`) {
                v.classList.add('active');
            } else {
                v.classList.add('hidden');
            }
        });

        this.state.currentTab = tab;

        // Manage navibar dock for chat input
        if (tab === 'chat') {
            this._openChatDock();
        } else {
            this._closeChatDock();
        }

        // Trigger renders
        if (tab === 'home') this.renderHome();
        if (tab === 'chat_list') this.renderChatList();
        if (tab === 'user_persona') this.renderUserPersona();
        if (tab === 'scenario') this._renderScenarioPage();
        if (tab === 'settings') this.renderThemeSettings();

        try { this._updateNav(); } catch { }
    }

    _registerNavibarButtons() {
        const navibar = window.Yuuka?.services?.navibar;
        if (!navibar) return;

        navibar.registerButton({
            id: 'chat-open-mode-chat-list',
            type: 'tools',
            pluginId: 'chat',
            order: 99,
            icon: 'chat',
            title: 'Mở tab: Chat List',
            isActive: () => this.state.currentTab === 'chat_list',
            onClick: () => {
                this.switchTab('chat_list');
            }
        });

        navibar.registerButton({
            id: 'chat-open-mode-user-persona',
            type: 'tools',
            pluginId: 'chat',
            order: 100,
            icon: 'person',
            title: 'Mở tab: User Persona',
            isActive: () => this.state.currentTab === 'user_persona',
            onClick: () => {
                this.switchTab('user_persona');
            }
        });
    }

    _updateNav() {
        const navibar = window.Yuuka?.services?.navibar;
        if (!navibar) return;
        navibar.setActivePlugin('chat');
        this._registerNavibarButtons();
    }
}

// Global register
window.ChatComponent = ChatComponent;
window.Yuuka = window.Yuuka || {};
window.Yuuka.components = window.Yuuka.components || {};
window.Yuuka.components['ChatComponent'] = ChatComponent;
