Object.assign(window.ChatComponent.prototype, {
    escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    formatMessageContent(str) {
        if (!str) return '';
        let result = str;

        // Strip XML/tag blocks that should never appear in rendered bubbles
        result = result.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '');
        result = result.replace(/<call_capability[^>]*>[\s\S]*?(<\/call_capability>|$)/gi, '');
        result = result.replace(/<emotion_update>[\s\S]*?(<\/emotion_update>|$)/gi, '');

        const autoLineBreakGlobal = localStorage.getItem('chat-auto-line-break') !== 'false';
        let rulesArr = [];
        try {
            const savedRules = localStorage.getItem('chat-format-rules');
            if (savedRules) rulesArr = JSON.parse(savedRules);
        } catch (e) {
            console.error("[Chat Utils] Failed to parse chat-format-rules:", e);
        }

        if (!rulesArr || !rulesArr.length) {
            rulesArr = [
                { rule: '**', type: 'Italic', linebreak: true },
                { rule: '****', type: 'Bold', linebreak: false },
                { rule: '""', type: 'Dialogue', linebreak: true },
            ];
        }

        // Sort rules by length descending to handle subsets correctly (e.g. **** before **)
        const sortedRules = [...rulesArr].sort((a, b) => (b.rule?.length || 0) - (a.rule?.length || 0));

        // 1. Separate tokens for line breaks if enabled
        if (autoLineBreakGlobal) {
            // Collect all potential linebreak matches
            let allMatches = [];
            sortedRules.filter(r => r.linebreak && r.rule && r.rule.length >= 1).forEach(r => {
                let left, right;
                if (r.rule.length % 2 === 0) {
                    const half = r.rule.length / 2;
                    left = this._escapeRegex(r.rule.substring(0, half));
                    right = this._escapeRegex(r.rule.substring(half));
                } else {
                    left = right = this._escapeRegex(r.rule);
                }
                const regex = new RegExp(`${left}[\\s\\S]*?${right}`, 'g');
                let match;
                while ((match = regex.exec(result)) !== null) {
                    allMatches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
                }
            });

            // Sort by start, then length (descending)
            allMatches.sort((a, b) => a.start - b.start || (b.end - a.end) - (a.end - b.end));

            // Remove overlapping matches (prefer first/longest)
            const filteredMatches = [];
            let lastPos = -1;
            allMatches.forEach(m => {
                if (m.start >= lastPos) {
                    filteredMatches.push(m);
                    lastPos = m.end;
                }
            });

            // Apply breaks based on surroundings
            let processedResult = '';
            let lastIdx = 0;
            filteredMatches.forEach((m, idx) => {
                // Peek left: from lastIdx to m.start
                const leftGap = result.substring(lastIdx, m.start);
                const hasLeftText = leftGap.trim() !== '';

                // Peek right: from m.end to start of next match (or end of string)
                const nextMatch = filteredMatches[idx + 1];
                const rightGap = result.substring(m.end, nextMatch ? nextMatch.start : result.length);
                const hasRightText = rightGap.trim() !== '';

                // Logic: Only break if it's NOT sandwiched by substantial text on either side.
                // If it's isolated (all neighbors are whitespace/boundaries), it's a block.
                processedResult += leftGap;
                if (!hasLeftText && !hasRightText) {
                    processedResult += `\n\n${m.text}\n\n`;
                } else {
                    processedResult += m.text;
                }
                lastIdx = m.end;
            });
            processedResult += result.substring(lastIdx);
            result = processedResult;

            result = result.replace(/\n\s*\n/g, '\n\n'); // compress multiple empty lines
            result = result.replace(/\n{3,}/g, '\n\n'); // max 2 newlines
            result = result.trim();
        }

        const escaped = this.escapeHTML(result);
        let formatted = escaped;

        // 2. Apply formatting styles (Italic, Bold, Dialogue, Codemark, Title, Subtitle)
        // Use placeholders to avoid rules matching against the HTML tags/attributes of previous rules (e.g. quotes in class="")
        const placeholders = [];
        
        sortedRules.forEach(r => {
            if (!r.rule || r.rule.length < 1) return;
            let left, right;
            if (r.rule.length % 2 === 0) {
                const half = r.rule.length / 2;
                left = this._escapeRegex(r.rule.substring(0, half));
                right = this._escapeRegex(r.rule.substring(half));
            } else {
                left = right = this._escapeRegex(r.rule);
            }
            const regex = new RegExp(`${left}([\\s\\S]*?)${right}`, 'g');
            
            let tag = 'span';
            let className = '';
            const type = (r.type || '').toLowerCase();
            if (type === 'italic') {
                tag = 'i';
                className = 'markdown-asterisk';
            } else if (type === 'bold') {
                tag = 'strong';
                className = 'markdown-bold';
            } else if (type === 'dialogue') {
                tag = 'span';
                className = 'markdown-dialogue';
            } else if (type === 'codemark') {
                tag = 'code';
                className = 'markdown-codemark';
            } else if (type === 'title') {
                tag = 'span';
                className = 'markdown-title';
            } else if (type === 'subtitle') {
                tag = 'span';
                className = 'markdown-subtitle';
            } else if (type === 'normal') {
                tag = 'span';
                className = 'markdown-normal';
            }

            formatted = formatted.replace(regex, (match, content) => {
                const id = `___CHAT_RULE_PH_${placeholders.length}___`;
                // If KEEP is enabled, use the full match (including delimiters)
                const finalContent = r.keep ? match : content;
                placeholders.push({ id, tag, className, content: finalContent });
                return id;
            });
        });

        // 3. Handle "Empty" rule (Default format for text not wrapped in any delimiters)
        const defaultRule = sortedRules.find(r => !r.rule || r.rule.trim() === '');
        if (defaultRule) {
            let tag = 'span';
            let className = '';
            const type = (defaultRule.type || '').toLowerCase();
            if (type === 'italic') {
                tag = 'i';
                className = 'markdown-asterisk';
            } else if (type === 'bold') {
                tag = 'strong';
                className = 'markdown-bold';
            } else if (type === 'dialogue') {
                tag = 'span';
                className = 'markdown-dialogue';
            } else if (type === 'codemark') {
                tag = 'code';
                className = 'markdown-codemark';
            } else if (type === 'title') {
                tag = 'span';
                className = 'markdown-title';
            } else if (type === 'subtitle') {
                tag = 'span';
                className = 'markdown-subtitle';
            } else if (type === 'normal') {
                tag = 'span';
                className = 'markdown-normal';
            }

            // Split by existing placeholders and wrap everything else
            const parts = formatted.split(/(___CHAT_RULE_PH_\d+___)/g);
            formatted = parts.map(p => {
                if (p.startsWith('___CHAT_RULE_PH_') && p.endsWith('___')) return p;
                if (!p.trim()) return p; // Don't wrap pure whitespace
                return `<${tag} class="${className}">${p}</${tag}>`;
            }).join('');
        }

        // Restore placeholders. We do it in a loop to handle nested formatting.
        let iterations = 0;
        while (formatted.includes('___CHAT_RULE_PH_') && iterations < 10) {
            formatted = formatted.replace(/___CHAT_RULE_PH_(\d+)___/g, (_, idx) => {
                const p = placeholders[parseInt(idx)];
                if (!p) return _;
                return `<${p.tag} class="${p.className}">${p.content}</${p.tag}>`;
            });
            iterations++;
        }

        const lines = formatted.split('\n');
        return lines.map(line => {
            if (!line.trim()) return '<span style="height: 0.5rem; display: block;"></span>';
            return `<span>${line}</span>`;
        }).join('');
    },

    /**
     * Render a single-line action label (system action cards).
     * Applies bold (**text**) and italic (*text*) without any line-break separation logic.
     * Handles mixed patterns like *actor gave **item** x1* correctly.
     */
    formatActionLabel(str) {
        if (!str) return '';
        const escaped = this.escapeHTML(str);
        // Step 1: replace **bold** with a placeholder to protect from italic regex
        const boldPlaceholder = '\x00BOLD\x00';
        const bolds = [];
        let s = escaped.replace(/\*\*([^*]+)\*\*/g, (_, inner) => {
            bolds.push(inner);
            return boldPlaceholder;
        });
        // Step 2: replace *italic* (now no ** inside)
        s = s.replace(/\*([^*]+)\*/g, '<i class="markdown-asterisk">$1</i>');
        // Step 3: restore bold placeholders
        s = s.replace(new RegExp(boldPlaceholder.replace(/\x00/g, '\\x00'), 'g'), () =>
            `<strong class="markdown-bold">${bolds.shift()}</strong>`
        );
        return `<span>${s}</span>`;
    },

    // --- System Action Label Builder ---

    /**
     * Builds a formatted label string for system_action messages.
     * All labels use *italic* wrapper with **bold** for item/action names.
     *
     * @param {'gift'|'action'|'outfit_change'|'stamina_exhausted'} type
     * @param {object} data
     *   gift:             { giver, receiver, item, qty? }
     *   action:           { actor, target, actionName }
     *   outfit_change:    { actor, verb, items[] }   — verb: 'put on'|'took off'
     *   stamina_exhausted:{ actor, newAction }
     */
    _buildActionLabel(type, data) {
        switch (type) {
            case 'gift': {
                const qty = data.qty && data.qty > 1 ? ` x${data.qty}` : ' x1';
                return `*${data.giver} gave ${data.receiver} **${data.item}**${qty}*`;
            }
            case 'action':
                return `*${data.actor} is **${data.actionName}** with ${data.target}*`;
            case 'outfit_change': {
                const itemList = data.items.map(i => `**${i}**`).join(', ');
                const suffix = data.target ? ` for ${data.target}` : '';
                return `*${data.actor} ${data.verb} ${itemList}${suffix}*`;
            }
            case 'stamina_exhausted':
                return `*${data.actor} was very tired so they changed to ${data.newAction}.*`;
            default:
                return `*${JSON.stringify(data)}*`;
        }
    },

    // --- Snapshot helpers ---
    migrateMessage(msg) {
        let m = { ...msg };
        if (!m.snapshots) {
            m.snapshots = [[m.content || '', [], null, null]];
            m.activeIndex = 0;
            delete m.content;
        } else {
            // Normalize all snapshots to 4-element arrays
            m.snapshots = m.snapshots.map(s => {
                if (typeof s === 'string') return [s, [], null, null];
                if (!Array.isArray(s)) return ['', [], null, null];
                if (s.length === 1) return [s[0], [], null, null];
                if (s.length === 2) return [s[0], s[1], null, null];
                if (s.length === 3) return [s[0], s[1], s[2], null];
                return s; // already 4 elements
            });
            if (m.activeIndex === undefined) m.activeIndex = 0;
        }

        // Migrate legacy status_snapshots → snapshot[2]
        if (m.status_snapshots) {
            m.status_snapshots.forEach((rec, i) => {
                if (rec && rec.status_after && m.snapshots[i]) {
                    m.snapshots[i][2] = rec.status_after;
                }
            });
            delete m.status_snapshots;
        }

        // Migrate legacy linked_actions → snapshot[activeIndex][3]
        if (m.linked_actions && m.snapshots[m.activeIndex]) {
            if (!m.snapshots[m.activeIndex][3]) {
                m.snapshots[m.activeIndex][3] = m.linked_actions;
            }
            delete m.linked_actions;
        }

        return m;
    },

    getMessageContent(msg) {
        const m = this.migrateMessage(msg);
        const snap = m.snapshots[m.activeIndex];
        let content = snap ? snap[0] : '';
        // Strip group_action tags so they never appear in rendered bubbles
        if (content && content.includes('<group_action>')) {
            content = content.replace(/<group_action>[\s\S]*?<\/group_action>/gi, '').trim();
        }
        return content;
    },

    getMessageImages(msg) {
        const m = this.migrateMessage(msg);
        const snap = m.snapshots[m.activeIndex];
        return (snap && snap[1]) ? snap[1] : [];
    },

    // --- Item & Inventory Helpers ---

    _normalizeItemName(name) {
        if (!name) return '';
        // Lowercase and normalize spaces/underscores for comparison
        return name.toLowerCase().replace(/_/g, ' ').trim();
    },

    _hasItemInList(list, itemName) {
        if (!list || !Array.isArray(list)) return false;
        const normalizedTarget = this._normalizeItemName(itemName);
        return list.some(item => this._normalizeItemName(item) === normalizedTarget);
    },

    // Convert snapshot messages to flat format for AI API
    flattenMessages(messages) {
        // Find indices of the last 2 assistant messages to preserve their <system_update> tags
        const assistantIndices = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
                assistantIndices.push(i);
                if (assistantIndices.length === 2) break;
            }
        }
        const keepTagSet = new Set(assistantIndices);

        return messages
            .filter(msg => {
                // Skip legacy system_action messages — action context is now in snapshot[3]
                if (msg.role === 'system' && msg.type === 'system_action') return false;
                return true;
            })
            .map((msg, i) => {
                const m = this.migrateMessage(msg);
                let content = this.getMessageContent(m);

                // Strip <system_update> from all assistant messages except the 2 most recent
                if (m.role === 'assistant' && !keepTagSet.has(i)) {
                    content = content.replace(/<system_update>[\s\S]*?(<\/system_update>|$)/gi, '').trim();
                }

                // For user messages: append action_context labels from snapshot[3] to LLM context
                if (m.role === 'user') {
                    const actionContext = m.snapshots[m.activeIndex] && m.snapshots[m.activeIndex][3];
                    if (actionContext && actionContext.length > 0) {
                        const actionText = actionContext.map(a => a.label).filter(Boolean).join(', ');
                        if (actionText) content = content ? `${content}\n${actionText}` : actionText;
                    }
                }

                return { role: m.role === 'assistant' ? 'assistant' : m.role, content };
            });
    }
});
