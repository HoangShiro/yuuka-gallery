Object.assign(window.ChatComponent.prototype, {
    // --- Rule (System Instruction) Edit Page ---

    openRuleEdit(ruleId) {
        this.state.editingRule = { id: ruleId };

        const titleEl = this.container.querySelector('#rule-edit-title');
        const nameInput = this.container.querySelector('#rule-edit-name');
        const contentInput = this.container.querySelector('#rule-edit-content');
        const saveBtn = this.container.querySelector('#btn-save-rule');
        const cloneBtn = this.container.querySelector('#btn-clone-rule');
        const applyToGroup = this.container.querySelector('#rule-apply-to-group');
        const applyToSelect = this.container.querySelector('#rule-edit-apply-to');

        titleEl.textContent = ruleId ? 'Edit Rule' : 'New Rule';

        nameInput.value = '';
        contentInput.value = '';
        nameInput.disabled = false;
        contentInput.disabled = false;
        if (saveBtn) saveBtn.style.display = '';
        if (cloneBtn) { cloneBtn.style.display = 'none'; cloneBtn.onclick = null; }

        // Hide apply-to by default; only show for non-default rules
        if (applyToGroup) applyToGroup.style.display = 'none';
        if (applyToSelect) applyToSelect.value = '';

        if (ruleId && this.state.scenarios?.rules?.[ruleId]) {
            const rule = this.state.scenarios.rules[ruleId];
            nameInput.value = rule.name || '';
            contentInput.value = rule.content || '';

            if (rule.is_default) {
                // Default rules: read-only, show Clone button
                nameInput.disabled = true;
                contentInput.disabled = true;
                if (saveBtn) saveBtn.style.display = 'none';
                if (cloneBtn) {
                    cloneBtn.style.display = '';
                    cloneBtn.onclick = () => this._handleCloneRule(ruleId);
                }
            } else {
                // Non-default rules: show apply-to dropdown
                if (applyToGroup) applyToGroup.style.display = '';
                if (applyToSelect) applyToSelect.value = rule.apply_to || '';
            }
        } else {
            // New rule: show apply-to dropdown
            if (applyToGroup) applyToGroup.style.display = '';
        }

        this.switchTab('rule_edit');

        setTimeout(() => {
            contentInput.style.height = 'auto';
            contentInput.style.height = contentInput.scrollHeight + 'px';
        }, 10);
    },

    async _handleCloneRule(ruleId) {
        const rule = this.state.scenarios?.rules?.[ruleId];
        if (!rule) return;

        // Generate clone name: "<name> clone 1", incrementing if needed
        const baseName = `${rule.name} clone`;
        const existingRules = Object.values(this.state.scenarios?.rules || {});
        let cloneIndex = 1;
        while (existingRules.some(r => r.name === `${baseName} ${cloneIndex}`)) {
            cloneIndex++;
        }
        const cloneName = `${baseName} ${cloneIndex}`;

        try {
            const res = await this.api['chat'].post('/scenarios/rules', {
                name: cloneName,
                content: rule.content,
                apply_to: null
            });
            if (res.status === 'success') {
                if (!this.state.scenarios) this.state.scenarios = { scenes: {}, rules: {} };
                this.state.scenarios.rules[res.data.id] = res.data;
                // Jump to the cloned rule's edit page
                this.openRuleEdit(res.data.id);
            } else {
                alert('Clone failed: ' + (res.error || 'Unknown'));
            }
        } catch (e) {
            console.error(e);
            alert('Error cloning rule.');
        }
    },

    async handleSaveRule() {
        const nameInput = this.container.querySelector('#rule-edit-name');
        const contentInput = this.container.querySelector('#rule-edit-content');
        const applyToSelect = this.container.querySelector('#rule-edit-apply-to');

        const name = nameInput.value.trim();
        if (!name) {
            alert('Please enter a rule name.');
            return;
        }

        const payload = {
            name,
            content: contentInput.value
        };

        const ruleId = this.state.editingRule?.id;
        const isDefault = ruleId && this.state.scenarios?.rules?.[ruleId]?.is_default;

        // Preserve is_default flag
        if (isDefault) {
            payload.is_default = true;
        } else {
            // Include apply_to for non-default rules
            payload.apply_to = applyToSelect ? (applyToSelect.value || null) : null;
        }

        const endpoint = ruleId
            ? `/scenarios/rules/${ruleId}`
            : '/scenarios/rules';

        try {
            const res = await this.api['chat'].post(endpoint, payload);
            if (res.status === 'success') {
                if (!this.state.scenarios) this.state.scenarios = { scenes: {}, rules: {} };
                // Backend may have cleared apply_to on other rules — reload all rules
                const scenariosRes = await this.api['chat'].get('/scenarios');
                this.state.scenarios = {
                    scenes: scenariosRes.scenes || {},
                    rules: scenariosRes.rules || {}
                };
                this.switchTab('scenario');
                this._renderScenarioPage();
            } else {
                alert('Save failed: ' + (res.error || 'Unknown'));
            }
        } catch (e) {
            console.error(e);
            alert('Error saving rule.');
        }
    }
});
