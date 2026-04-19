/* ============================================================
   TERRA – roles.js
   Roles & Permissions // RBAC Editor

   Tactical/security-operations aesthetic — mirrors the
   Manage Users page conventions.

   Features:
     ✦ Role registry list (left panel) with clearance tiers
     ✦ Permission set editor (right panel) — click to toggle
     ✦ Unsaved-change tracking with amber dirty indicator
     ✦ Atomic save via PATCH /roles/:id/permissions
     ✦ Create new role with POST /roles
     ✦ Delete role with guard (refuses if users assigned)
     ✦ Read-only permission matrix at the bottom

   API consumed:
     GET    /api/roles                 – roles + permissions + user count
     GET    /api/roles/permissions     – all permission slugs
     POST   /api/roles                 – create role
     PATCH  /api/roles/:id/permissions – replace permission set
     DELETE /api/roles/:id             – delete role
   ============================================================ */

const RolesPage = (() => {

    /* ── Module state ────────────────────────────────────── */
    let _roles    = [];   // All roles (from API — includes { permissions: [{permission_id, slug}] })
    let _allPerms = [];   // All available permissions [{permission_id, slug}]
    let _selected = null; // Currently selected role object
    let _pending  = new Set(); // permission_ids currently toggled ON (pending save)
    let _dirty    = false;
    let _matrixOpen = false;

    /* ── Permission metadata ─────────────────────────────── */
    const PERM_META = {
        'export_data':            { label: 'Export & Analytics',       desc: 'Export datasets, access site analysis and analytics dashboards' },
        'manage_roles':           { label: 'Manage Roles',             desc: 'Create, modify, and delete RBAC roles and permission assignments' },
        'manage_users':           { label: 'Manage Operators',         desc: 'View, verify, suspend, and permanently revoke operator accounts' },
        'submit_report':          { label: 'Submit Reports',           desc: 'Create and submit new wildlife sighting reports' },
        'validate_report':        { label: 'Validate Reports',         desc: 'Approve or reject pending report submissions' },
        'view_audit_logs':        { label: 'View Audit Logs',          desc: 'Access the immutable system event audit log' },
        'view_own_reports':       { label: 'View Own Reports',         desc: 'Access personal submission history and status' },
        'view_pending_reports':   { label: 'View Pending Queue',       desc: 'Access the full pending report review queue' },
        'view_protected_reports': { label: 'View Protected Reports',   desc: 'Access validated and sensitivity-tiered sightings' },
    };

    /* ── Clearance tier map ──────────────────────────────── */
    const CLEARANCE = {
        COMMUNITY: { tier: 0, label: 'CL-0', cls: 'rp-cl--community' },
        ANALYST:   { tier: 1, label: 'CL-1', cls: 'rp-cl--analyst'   },
        RANGER:    { tier: 2, label: 'CL-2', cls: 'rp-cl--ranger'    },
        ADMIN:     { tier: 3, label: 'CL-3', cls: 'rp-cl--admin'     },
    };

    function clearanceFor(name) {
        return CLEARANCE[(name || '').toUpperCase()] || { tier: -1, label: 'CL-?', cls: '' };
    }

    function esc(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[m]));
    }

    /* ══════════════════════════════════════════════════════
       STAT STRIP
    ══════════════════════════════════════════════════════ */

    function buildStatStrip() {
        const totalRoles = _roles.length;
        const totalPerms = _allPerms.length;
        const totalAssign = _roles.reduce((sum, r) => sum + (r.permissions?.length || 0), 0);
        const totalOps    = _roles.reduce((sum, r) => sum + (r.user_count || 0), 0);

        return `
        <div class="rp-stat-strip">
            <div class="rp-stat">
                <div class="rp-stat__val">${totalRoles}</div>
                <div class="rp-stat__label">Roles Defined</div>
            </div>
            <div class="rp-stat">
                <div class="rp-stat__val rp-stat__val--brand">${totalPerms}</div>
                <div class="rp-stat__label">Permission Slugs</div>
            </div>
            <div class="rp-stat">
                <div class="rp-stat__val rp-stat__val--amber">${totalAssign}</div>
                <div class="rp-stat__label">Total Assignments</div>
            </div>
            <div class="rp-stat">
                <div class="rp-stat__val">${totalOps}</div>
                <div class="rp-stat__label">Operators Enrolled</div>
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════
       ROLE LIST (left panel)
    ══════════════════════════════════════════════════════ */

    function buildRoleList() {
        const sorted = [..._roles].sort((a, b) => {
            const ta = clearanceFor(a.name).tier;
            const tb = clearanceFor(b.name).tier;
            return ta - tb;
        });

        const items = sorted.map(role => {
            const cl = clearanceFor(role.name);
            const isActive = _selected && _selected.role_id === role.role_id;
            const permCount = role.permissions?.length || 0;
            return `
            <div class="rp-role-item ${isActive ? 'active' : ''}"
                 data-role-id="${role.role_id}">
                <span class="rp-cl ${cl.cls}">${cl.label}</span>
                <div style="flex:1;min-width:0;">
                    <div class="rp-role-item__name">${esc(role.name)}</div>
                    <div class="rp-role-item__perm-count">${permCount} permission${permCount !== 1 ? 's' : ''}</div>
                </div>
                <span class="rp-role-item__count" title="${role.user_count} operator${role.user_count !== 1 ? 's' : ''} assigned">
                    ${role.user_count}
                </span>
            </div>
            `;
        }).join('');

        return `
        <div class="rp-role-list">
            <div class="rp-role-list__header">
                <span class="rp-role-list__title">Role Registry</span>
            </div>
            <div class="rp-role-items" id="rp-role-items">
                ${items || '<div style="padding:var(--sp-6);color:var(--clr-text-dim);font-size:var(--text-xs);font-family:var(--font-mono);">No roles found.</div>'}
            </div>
            <div class="rp-add-role-btn">
                <button class="btn btn--secondary btn--sm" id="btn-new-role" style="width:100%;">+ NEW ROLE</button>
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════
       PERMISSION EDITOR (right panel)
    ══════════════════════════════════════════════════════ */

    function buildPermPanel() {
        if (!_selected) {
            return `
            <div class="rp-perm-panel">
                <div class="rp-perm-panel__empty">
                    <div class="rp-perm-panel__empty-icon">◎</div>
                    <div>Select a role to edit its permission set</div>
                </div>
            </div>
            `;
        }

        const cl = clearanceFor(_selected.name);

        const permRows = _allPerms.map(p => {
            const isOn = _pending.has(p.permission_id);
            const meta = PERM_META[p.slug] || { label: p.slug, desc: '' };
            return `
            <div class="rp-perm-row ${isOn ? 'rp-perm-row--on' : 'rp-perm-row--off'}"
                 data-perm-id="${p.permission_id}" data-slug="${p.slug}">
                <div class="rp-perm-indicator">${isOn ? '●' : '○'}</div>
                <div>
                    <div class="rp-perm-slug">${esc(p.slug)}</div>
                    <div class="rp-perm-desc">${esc(meta.desc)}</div>
                </div>
                <div class="rp-perm-status">${isOn ? 'GRANTED' : 'DENIED'}</div>
            </div>
            `;
        }).join('');

        const canDelete = Auth.hasPermission('manage_roles');
        const deleteDisabled = (_selected.user_count || 0) > 0;
        const deleteTitle = deleteDisabled
            ? `Cannot delete: ${_selected.user_count} operator${_selected.user_count !== 1 ? 's' : ''} assigned`
            : 'Permanently delete this role';

        return `
        <div class="rp-perm-panel">
            <div class="rp-perm-panel__header">
                <div class="rp-perm-panel__role">
                    <span class="rp-cl ${cl.cls}">${cl.label}</span>
                    <span class="rp-perm-panel__role-name">${esc(_selected.name)}</span>
                    <span class="rp-perm-panel__meta">
                        // ${_selected.user_count || 0} operator${(_selected.user_count || 0) !== 1 ? 's' : ''}
                        &nbsp;·&nbsp; ${_pending.size} / ${_allPerms.length} permissions
                    </span>
                </div>
                ${canDelete ? `
                <div class="rp-perm-panel__actions">
                    <button class="btn btn--sm btn--primary" id="btn-save-perms">SAVE CHANGES</button>
                    <button class="btn--danger btn--sm" id="btn-delete-role"
                            ${deleteDisabled ? 'disabled title="' + esc(deleteTitle) + '"' : 'title="' + esc(deleteTitle) + '"'}
                            style="padding:var(--sp-2) var(--sp-4);font-size:var(--text-xs);">
                        DELETE ROLE
                    </button>
                </div>` : ''}
            </div>
            <div class="rp-perm-panel__dirty ${_dirty ? 'visible' : ''}" id="rp-dirty-bar">
                ⚠ UNSAVED CHANGES — click SAVE CHANGES to apply
            </div>
            <div class="rp-perm-list" id="rp-perm-list">
                ${permRows}
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════
       PERMISSION MATRIX
    ══════════════════════════════════════════════════════ */

    function buildMatrix() {
        const sorted = [..._roles].sort((a, b) =>
            clearanceFor(a.name).tier - clearanceFor(b.name).tier
        );
        const allSlugs = _allPerms.map(p => p.slug);

        const headerCells = sorted.map(r => {
            const cl = clearanceFor(r.name);
            return `
            <div class="rp-mx-header">
                <span class="rp-cl ${cl.cls}">${cl.label}</span>
                <div class="rp-mx-role-name">${esc(r.name)}</div>
                <div class="rp-mx-role-count">${r.user_count} op${r.user_count !== 1 ? 's' : ''}</div>
            </div>
            `;
        }).join('');

        const rows = allSlugs.map(slug => {
            const cells = sorted.map(r => {
                const slugs = (r.permissions || []).map(p => p.slug || p);
                const has = slugs.includes(slug);
                return `<div class="rp-mx-cell ${has ? 'rp-mx-cell--on' : 'rp-mx-cell--off'}">${has ? '●' : '○'}</div>`;
            }).join('');
            return `
            <div class="rp-mx-slug">${esc(slug)}</div>
            ${cells}
            `;
        }).join('');

        return `
        <div class="rp-matrix-section">
            <div class="rp-matrix-header">
                <div>
                    <div class="rp-matrix-title">Permission Matrix // Full Access Map</div>
                    <div style="font-size:var(--text-xs);color:var(--clr-text-dim);margin-top:var(--sp-1);font-family:var(--font-mono);">
                        ● granted &nbsp;·&nbsp; ○ denied &nbsp;·&nbsp;
                        ${allSlugs.length} permission${allSlugs.length !== 1 ? 's' : ''} &times; ${sorted.length} role${sorted.length !== 1 ? 's' : ''}
                    </div>
                </div>
                <button class="btn btn--secondary btn--sm" id="btn-toggle-matrix">EXPAND MATRIX</button>
            </div>
            <div class="rp-matrix-body ${_matrixOpen ? 'visible' : ''}" id="rp-matrix-body">
                <div class="rp-mx-grid" style="--role-count:${sorted.length}">
                    <div class="rp-mx-slug rp-mx-slug--head">PERMISSION SLUG</div>
                    ${headerCells}
                    ${rows}
                </div>
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════
       SELECT A ROLE
    ══════════════════════════════════════════════════════ */

    function selectRole(role) {
        if (_dirty) {
            if (!confirm('You have unsaved changes. Discard them?')) return;
        }
        _selected = role;
        _dirty = false;
        // Initialise pending set from role's current permissions
        _pending = new Set(
            (role.permissions || []).map(p => p.permission_id || p)
        );
        rerenderWorkspace();
    }

    /* ══════════════════════════════════════════════════════
       TOGGLE A PERMISSION ROW
    ══════════════════════════════════════════════════════ */

    function togglePerm(permId, slug, rowEl) {
        if (_pending.has(permId)) {
            _pending.delete(permId);
            rowEl.classList.remove('rp-perm-row--on');
            rowEl.classList.add('rp-perm-row--off');
            rowEl.querySelector('.rp-perm-indicator').textContent = '○';
            rowEl.querySelector('.rp-perm-status').textContent = 'DENIED';
        } else {
            _pending.add(permId);
            rowEl.classList.remove('rp-perm-row--off');
            rowEl.classList.add('rp-perm-row--on');
            rowEl.querySelector('.rp-perm-indicator').textContent = '●';
            rowEl.querySelector('.rp-perm-status').textContent = 'GRANTED';
        }
        _dirty = true;
        const dirtyBar = document.getElementById('rp-dirty-bar');
        if (dirtyBar) dirtyBar.classList.add('visible');

        // Update meta count in header
        const metaEl = document.querySelector('.rp-perm-panel__meta');
        if (metaEl) {
            const sel = _selected;
            metaEl.textContent = `// ${sel.user_count || 0} operator${(sel.user_count || 0) !== 1 ? 's' : ''} · ${_pending.size} / ${_allPerms.length} permissions`;
        }
    }

    /* ══════════════════════════════════════════════════════
       SAVE PERMISSIONS
    ══════════════════════════════════════════════════════ */

    async function savePermissions() {
        if (!_selected) return;
        const btn = document.getElementById('btn-save-perms');
        if (btn) { btn.disabled = true; btn.textContent = 'SAVING…'; }

        try {
            await API.patch(`/roles/${_selected.role_id}/permissions`, {
                permission_ids: [..._pending],
            });
            Toast.success(`Permissions saved for "${_selected.name}".`);
            _dirty = false;

            // Sync local state
            _selected.permissions = _allPerms
                .filter(p => _pending.has(p.permission_id))
                .map(p => ({ permission_id: p.permission_id, slug: p.slug }));

            // Update role in _roles array
            const idx = _roles.findIndex(r => r.role_id === _selected.role_id);
            if (idx !== -1) _roles[idx].permissions = _selected.permissions;

            rerenderPage();
        } catch (err) {
            Toast.error(err.message || 'Failed to save permissions.');
            if (btn) { btn.disabled = false; btn.textContent = 'SAVE CHANGES'; }
        }
    }

    /* ══════════════════════════════════════════════════════
       DELETE ROLE
    ══════════════════════════════════════════════════════ */

    function openDeleteRoleModal() {
        if (!_selected) return;
        Modal.open({
            title: 'Delete Role',
            body: `
            <div style="display:flex;flex-direction:column;gap:var(--sp-4);">
                <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);padding:var(--sp-4);font-size:var(--text-sm);">
                    <strong style="color:var(--clr-danger);">⚠ This is permanent.</strong>
                    Role <code>${esc(_selected.name)}</code> and all its permission assignments will be deleted.
                    This cannot be undone.
                </div>
                <div class="form-group">
                    <label class="form-label">Type the role name to confirm</label>
                    <input id="del-role-confirm" class="form-input" type="text"
                           placeholder="${esc(_selected.name)}" autocomplete="off" />
                </div>
            </div>
            `,
            confirmLabel: 'DELETE ROLE',
            onConfirm: async () => {
                const typed = document.getElementById('del-role-confirm')?.value?.trim();
                if (typed !== _selected.name) {
                    Toast.error('Role name does not match. Deletion cancelled.');
                    return;
                }
                try {
                    await API.delete(`/roles/${_selected.role_id}`);
                    Toast.success(`Role "${_selected.name}" deleted.`);
                    _selected = null;
                    _dirty = false;
                    _pending = new Set();
                    await reloadData();
                    rerenderPage();
                } catch (err) {
                    Toast.error(err.message || 'Failed to delete role.');
                }
            },
        });
    }

    /* ══════════════════════════════════════════════════════
       CREATE NEW ROLE
    ══════════════════════════════════════════════════════ */

    function openNewRoleModal() {
        Modal.open({
            title: 'Create New Role',
            body: `
            <div class="form-group">
                <label class="form-label">Role Name</label>
                <input id="new-role-name" class="form-input" type="text"
                       placeholder="e.g. FIELD_LEAD" autocomplete="off"
                       style="text-transform:uppercase;" />
                <div style="font-size:var(--text-xs);color:var(--clr-text-muted);margin-top:var(--sp-2);font-family:var(--font-mono);">
                    Letters, numbers, underscores only. Will be uppercased automatically.
                </div>
            </div>
            `,
            confirmLabel: 'CREATE',
            onConfirm: async () => {
                const name = document.getElementById('new-role-name')?.value?.trim();
                if (!name) { Toast.error('Role name is required.'); return; }
                try {
                    const created = await API.post('/roles', { name });
                    Toast.success(`Role "${created.name}" created.`);
                    await reloadData();
                    // Select the new role
                    _selected = _roles.find(r => r.role_id === created.role_id) || null;
                    if (_selected) {
                        _pending = new Set();
                        _dirty = false;
                    }
                    rerenderPage();
                } catch (err) {
                    Toast.error(err.message || 'Failed to create role.');
                }
            },
        });
    }

    /* ══════════════════════════════════════════════════════
       RE-RENDER HELPERS
    ══════════════════════════════════════════════════════ */

    function rerenderWorkspace() {
        const listEl   = document.getElementById('rp-list-wrap');
        const panelEl  = document.getElementById('rp-panel-wrap');
        const statsEl  = document.getElementById('rp-stat-strip');
        const matrixEl = document.getElementById('rp-matrix-wrap');

        if (statsEl)  statsEl.innerHTML  = buildStatStrip();
        if (listEl)   listEl.innerHTML   = buildRoleList();
        if (panelEl)  panelEl.innerHTML  = buildPermPanel();
        if (matrixEl) matrixEl.innerHTML = buildMatrix();

        attachListeners();
    }

    function rerenderPage() {
        const statsEl  = document.getElementById('rp-stat-strip');
        const listEl   = document.getElementById('rp-list-wrap');
        const panelEl  = document.getElementById('rp-panel-wrap');
        const matrixEl = document.getElementById('rp-matrix-wrap');

        if (statsEl)  statsEl.innerHTML  = buildStatStrip();
        if (listEl)   listEl.innerHTML   = buildRoleList();
        if (panelEl)  panelEl.innerHTML  = buildPermPanel();
        if (matrixEl) matrixEl.innerHTML = buildMatrix();

        attachListeners();
    }

    /* ══════════════════════════════════════════════════════
       ATTACH LISTENERS
    ══════════════════════════════════════════════════════ */

    function attachListeners() {
        // Role list items
        document.querySelectorAll('.rp-role-item').forEach(el => {
            el.addEventListener('click', () => {
                const role = _roles.find(r => r.role_id === el.dataset.roleId);
                if (role) selectRole(role);
            });
        });

        // Permission rows toggle
        document.querySelectorAll('.rp-perm-row').forEach(row => {
            row.addEventListener('click', () => {
                const permId = row.dataset.permId;
                const slug   = row.dataset.slug;
                togglePerm(permId, slug, row);
            });
        });

        // Save permissions
        document.getElementById('btn-save-perms')?.addEventListener('click', savePermissions);

        // Delete role
        document.getElementById('btn-delete-role')?.addEventListener('click', () => {
            if (!document.getElementById('btn-delete-role').disabled) {
                openDeleteRoleModal();
            }
        });

        // New role
        document.getElementById('btn-new-role')?.addEventListener('click', openNewRoleModal);

        // Matrix toggle
        document.getElementById('btn-toggle-matrix')?.addEventListener('click', () => {
            _matrixOpen = !_matrixOpen;
            const body = document.getElementById('rp-matrix-body');
            const btn  = document.getElementById('btn-toggle-matrix');
            if (body) body.classList.toggle('visible', _matrixOpen);
            if (btn)  btn.textContent = _matrixOpen ? 'COLLAPSE MATRIX' : 'EXPAND MATRIX';
        });
    }

    /* ══════════════════════════════════════════════════════
       DATA LOADING
    ══════════════════════════════════════════════════════ */

    async function reloadData() {
        [_roles, _allPerms] = await Promise.all([
            API.get('/roles'),
            API.get('/roles/permissions'),
        ]);
    }

    /* ══════════════════════════════════════════════════════
       PUBLIC ENTRY
    ══════════════════════════════════════════════════════ */

    async function render(container) {
        if (!Auth.hasPermission('manage_roles')) {
            container.innerHTML = `
            <div class="rp-page">
                <div class="page-header">
                    <h1>Roles &amp; Permissions</h1>
                    <p>Access denied: requires <code>manage_roles</code> permission.</p>
                </div>
            </div>`;
            return;
        }

        // Loading skeleton
        container.innerHTML = `
        <div class="rp-page anim-fade-in">
            <div class="rp-hero">
                <div>
                    <div class="rp-hero__eyebrow">Terra // RBAC Engine</div>
                    <h1 class="rp-hero__title">Roles &amp;<br>Permissions</h1>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:var(--sp-3);color:var(--clr-text-muted);font-family:var(--font-mono);font-size:var(--text-sm);">
                <div class="spinner"></div> Loading role definitions…
            </div>
        </div>`;

        try {
            _selected = null;
            _dirty    = false;
            _pending  = new Set();
            await reloadData();
        } catch (err) {
            container.innerHTML = `
            <div class="rp-page">
                <div class="page-header"><h1>Roles &amp; Permissions</h1></div>
                <div class="card" style="padding:var(--sp-8);text-align:center;">
                    <p class="form-error">Failed to load role data: ${err.message}</p>
                </div>
            </div>`;
            return;
        }

        container.innerHTML = `
        <div class="rp-page anim-fade-in">

            <!-- Hero -->
            <div class="rp-hero">
                <div>
                    <div class="rp-hero__eyebrow">Terra // RBAC Engine</div>
                    <h1 class="rp-hero__title">Roles &amp;<br>Permissions</h1>
                </div>
                <div class="rp-hero__desc">
                    Define clearance tiers, assign permission slugs to roles,<br>
                    and control what each operator class can access across Terra.
                </div>
            </div>

            <!-- Stat strip -->
            <div id="rp-stat-strip">${buildStatStrip()}</div>

            <!-- Workspace split -->
            <div class="rp-workspace">
                <div id="rp-list-wrap">${buildRoleList()}</div>
                <div id="rp-panel-wrap">${buildPermPanel()}</div>
            </div>

            <!-- Permission matrix -->
            <div id="rp-matrix-wrap">${buildMatrix()}</div>

        </div>
        `;

        attachListeners();
    }

    return { render };
})();
