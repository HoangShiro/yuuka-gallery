(function () {
    window.Yuuka = window.Yuuka || {};
    window.Yuuka.liveGen = window.Yuuka.liveGen || {};

    const helpers = window.Yuuka.liveGen.helpers;

    window.Yuuka.liveGen.Autocomplete = {
        attachAutocomplete(input, tags, characters, onInputCallback) {
            if (!input || !tags.length) return;
            const field = input.closest(".live-gen-prompt-field");
            if (!field || field.dataset.autocompleteReady === "true") return;
            field.dataset.autocompleteReady = "true";
            try {
                this.initTagAutocompleteWithThumbnail(field, tags, characters, onInputCallback);
            } catch (err) {
                console.error("Autocomplete init failed:", err);
            }
        },

        initTagAutocompleteWithThumbnail(formContainer, tagPredictions, characters, onInputCallback) {
            if (!tagPredictions || !tagPredictions.length) return;
            formContainer.querySelectorAll('textarea, input[type="text"]').forEach(input => {
                if (input.parentElement.classList.contains('tag-autocomplete-container')) return;
                const wrapper = document.createElement('div');
                wrapper.className = 'tag-autocomplete-container';
                input.parentElement.insertBefore(wrapper, input);
                wrapper.appendChild(input);
                const list = document.createElement('ul');
                list.className = 'tag-autocomplete-list';
                wrapper.appendChild(list);
                let activeIndex = -1;
                const hide = () => { list.style.display = 'none'; list.innerHTML = ''; activeIndex = -1; };
                
                input.addEventListener('input', () => {
                    const textValue = input.value;
                    const cursor = input.selectionStart;
                    const before = textValue.substring(0, cursor);
                    const lastComma = before.lastIndexOf(',');
                    const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
                    const lastSep = Math.max(lastComma, lastNewline);
                    const current = before.substring(lastSep + 1).trim();
                    
                    if (current.length < 1) { hide(); return; }
                    const search = current.replace(/\s+/g, '_').toLowerCase();
                    
                    const matches = tagPredictions
                        .map(t => {
                            const tLower = t.toLowerCase();
                            let score = 0;
                            if (tLower === search) {
                                score = 4;
                            } else if (tLower.startsWith(search)) {
                                score = 3;
                            } else if (tLower.includes('_' + search) || tLower.includes('(' + search)) {
                                score = 2;
                            } else if (tLower.includes(search)) {
                                score = 1;
                            }
                            return { tag: t, score };
                        })
                        .filter(x => x.score > 0)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, 15)
                        .map(x => x.tag);

                    if (matches.length) {
                        list.innerHTML = matches.map(m => {
                            const foundChar = (Array.isArray(characters) && characters.length) ? characters.find(c => {
                                if (!c || !c.name) return false;
                                const cName = c.name.replace(/\s+/g, '_').toLowerCase();
                                return cName === m || cName.startsWith(m) || m.startsWith(cName);
                            }) : null;
                            
                            if (foundChar) {
                                const imgUrl = `/image/${foundChar.hash}`;
                                return `
                                    <li class="tag-autocomplete-item tag-autocomplete-item--character" data-tag="${m}">
                                        <div class="autocomplete-char-thumb">
                                            <img src="${imgUrl}" alt="${helpers.escapeHtml(foundChar.name)}" loading="lazy">
                                        </div>
                                        <div class="autocomplete-char-meta">
                                            <span class="autocomplete-char-name">${helpers.escapeHtml(m.replace(/_/g, ' '))}</span>
                                            <span class="autocomplete-char-label">Nhân vật</span>
                                        </div>
                                    </li>`;
                            } else {
                                return `<li class="tag-autocomplete-item" data-tag="${m}">${m.replace(/_/g, ' ')}</li>`;
                            }
                        }).join('');
                        list.style.display = 'block';
                        activeIndex = -1;
                    } else hide();
                });
                
                const applyTag = tag => {
                    const textValue = input.value;
                    const cursor = input.selectionStart;
                    const before = textValue.substring(0, cursor);
                    const after = textValue.substring(cursor);
                    
                    const lastComma = before.lastIndexOf(',');
                    const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
                    const lastSep = Math.max(lastComma, lastNewline);
                    
                    const nextComma = after.indexOf(',');
                    const nextNewline = after.indexOf('\n');
                    const nextCarriageReturn = after.indexOf('\r');
                    const afterSepIndices = [nextComma, nextNewline, nextCarriageReturn].filter(idx => idx !== -1);
                    const nextSep = afterSepIndices.length > 0 ? Math.min(...afterSepIndices) : -1;
                    
                    let prefix = textValue.substring(0, lastSep + 1);
                    let suffix = nextSep !== -1 ? after.substring(nextSep) : "";
                    
                    if (prefix.endsWith(',')) {
                        prefix += ' ';
                    } else if (prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n') && !prefix.endsWith('\r')) {
                        prefix += ' ';
                    }
                    
                    if (suffix.startsWith(',')) {
                        suffix = suffix.substring(1).replace(/^\s+/, '');
                    }
                    
                    const insertedTag = tag.replace(/_/g, ' ');
                    const result = `${prefix}${insertedTag}, ${suffix}`;
                    
                    input.value = result;
                    const newCursor = prefix.length + insertedTag.length + 2;
                    input.focus();
                    input.setSelectionRange(newCursor, newCursor);
                    hide();
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                
                list.addEventListener('mousedown', ev => {
                    ev.preventDefault();
                    const item = ev.target.closest('.tag-autocomplete-item');
                    if (item) applyTag(item.dataset.tag);
                });
                input.addEventListener('keydown', ev => {
                    const items = list.querySelectorAll('.tag-autocomplete-item');
                    if (!items.length) return;
                    if (ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        activeIndex = (activeIndex + 1) % items.length;
                    } else if (ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        activeIndex = (activeIndex - 1 + items.length) % items.length;
                    } else if ((ev.key === 'Enter' || ev.key === 'Tab') && activeIndex > -1) {
                        ev.preventDefault();
                        applyTag(items[activeIndex].dataset.tag);
                    } else if (ev.key === 'Escape') {
                        hide();
                    }
                    items.forEach((it, idx) => it.classList.toggle('active', idx === activeIndex));
                });
                input.addEventListener('blur', () => setTimeout(hide, 150));
            });
        }
    };
})();
