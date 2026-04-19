/* ============================================================
   TERRA – users.js
   Operator Management // Access Control Roster

   Tactical/security-operations aesthetic:
     ✦ SOC terminology: Operators, Provision, Revoke, Clearance
     ✦ Role hierarchy as clearance tiers (CL-0 → CL-3)
     ✦ Threat-status dots (VERIFIED / PENDING / SUSPENDED)
     ✦ Permission matrix: firewall-rule table across all roles
     ✦ Inline role reassignment without page navigation
     ✦ Self-mutation guards on all destructive actions

   API consumed:
     GET    /api/users             – full roster
     GET    /api/users/roles       – role definitions + permissions
     PATCH  /api/users/:id/role    – reassign clearance
     PATCH  /api/users/:id/status  – set access status
     DELETE /api/users/:id         – revoke access permanently
     POST   /api/auth/register     – provision new operator
   ============================================================ */

const UsersPage = (() => {

    /* ── Module state ────────────────────────────────────────── */
    let _users     = [];   // Full roster from API
    let _roles     = [];   // Role definitions with permission arrays
    let _filtered  = [];   // After search/filter

    /* Filter state */
    let _searchQ     = '';
    let _roleFilter  = '';
    let _statusFilter = '';

    /* Current user — used for self-guard highlighting */
    const _selfId = () => Auth.getUser()?.user_id;

    /* ══════════════════════════════════════════════════════════
       ROLE / STATUS DISPLAY HELPERS
    ══════════════════════════════════════════════════════════ */

    /*
     * Clearance tiers map role names to a level number and colour.
     * Mirrors the sensitivity tier concept from reports:
     *   CL-0 Community  — read-only, public access
     *   CL-1 Analyst    — data read + export (cyan)
     *   CL-2 Ranger     — field ops, validate (brand lime)
     *   CL-3 Admin      — full system access (danger red)
     */
    const CLEARANCE = {
        COMMUNITY: { tier: 0, label: 'CL-0', cls: 'um-cl--community' },
        ANALYST:   { tier: 1, label: 'CL-1', cls: 'um-cl--analyst'   },
        RANGER:    { tier: 2, label: 'CL-2', cls: 'um-cl--ranger'    },
        ADMIN:     { tier: 3, label: 'CL-3', cls: 'um-cl--admin'     },
    };

    function clearanceFor(roleName) {
        return CLEARANCE[(roleName || '').toUpperCase()] || { tier: 0, label: 'CL-?', cls: '' };
    }

    /* Verification status display — coloured dot + label */
    const STATUS_META = {
        VERIFIED:  { cls: 'um-status--verified',  dot: 'um-dot--green',  label: 'VERIFIED'  },
        PENDING:   { cls: 'um-status--pending',   dot: 'um-dot--amber',  label: 'PENDING'   },
        SUSPENDED: { cls: 'um-status--suspended', dot: 'um-dot--red',    label: 'SUSPENDED' },
    };

    function statusMeta(status) {
        return STATUS_META[(status || '').toUpperCase()] || STATUS_META.PENDING;
    }

    /* Escape HTML in user-supplied strings */
    function esc(str) {
        return String(str || '').replace(/[&<>"']/g, m => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[m]));
    }

    /* ══════════════════════════════════════════════════════════
       KPI / STAT STRIP
    ══════════════════════════════════════════════════════════ */

    function buildStatStrip() {
        const total     = _users.length;
        const verified  = _users.filter(u => u.verification_status === 'VERIFIED').length;
        const pending   = _users.filter(u => u.verification_status === 'PENDING').length;
        const suspended = _users.filter(u => u.verification_status === 'SUSPENDED').length;

        const roleCounts = {};
        _users.forEach(u => {
            const r = u.role_name || 'UNKNOWN';
            roleCounts[r] = (roleCounts[r] || 0) + 1;
        });

        const roleBreakdown = Object.entries(roleCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([role, n]) => {
                const cl = clearanceFor(role);
                return `<span class="um-role-chip ${cl.cls}">${cl.label} ${esc(role)} <strong>${n}</strong></span>`;
            }).join('');

        return `
        <div class="um-stat-strip">
            <div class="um-stat">
                <div class="um-stat__val">${total}</div>
                <div class="um-stat__label">Total Operators</div>
            </div>
            <div class="um-stat">
                <div class="um-stat__val um-stat__val--green">${verified}</div>
                <div class="um-stat__label">Verified</div>
            </div>
            <div class="um-stat um-stat--alert">
                <div class="um-stat__val um-stat__val--amber">${pending}</div>
                <div class="um-stat__label">Pending</div>
            </div>
            <div class="um-stat ${suspended > 0 ? 'um-stat--threat' : ''}">
                <div class="um-stat__val um-stat__val--red">${suspended}</div>
                <div class="um-stat__label">Suspended</div>
            </div>
            <div class="um-stat um-stat--roles">
                <div class="um-stat__label" style="margin-bottom:var(--sp-2)">Clearance Distribution</div>
                <div class="um-role-chips">${roleBreakdown || '—'}</div>
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════════
       CONTROLS BAR
    ══════════════════════════════════════════════════════════ */

    function buildControls() {
        const roleOptions = [...new Set(_users.map(u => u.role_name).filter(Boolean))]
            .sort()
            .map(r => `<option value="${r}"${_roleFilter===r?'selected':''}>${r}</option>`)
            .join('');

        return `
        <div class="um-controls">
            <div class="um-controls__left">
                <div class="um-search-wrap">
                    <span class="um-search-icon">⌕</span>
                    <input
                        id="um-search"
                        class="um-search"
                        type="search"
                        placeholder="Search handle / email / operator ID…"
                        value="${esc(_searchQ)}"
                        autocomplete="off"
                    />
                </div>
                <select id="um-filter-role" class="um-select">
                    <option value="">All Clearances</option>
                    ${roleOptions}
                </select>
                <select id="um-filter-status" class="um-select">
                    <option value="">All Statuses</option>
                    <option value="VERIFIED"  ${_statusFilter==='VERIFIED' ?'selected':''}>Verified</option>
                    <option value="PENDING"   ${_statusFilter==='PENDING'  ?'selected':''}>Pending</option>
                    <option value="SUSPENDED" ${_statusFilter==='SUSPENDED'?'selected':''}>Suspended</option>
                </select>
                <span class="um-result-count" id="um-result-count">${_filtered.length} operators</span>
            </div>
            <div class="um-controls__right">
                <button class="btn btn--secondary" id="btn-toggle-matrix">PERMISSION MATRIX</button>
                <button class="btn btn--primary" id="btn-provision">+ PROVISION OPERATOR</button>
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════════
       OPERATOR ROSTER TABLE
    ══════════════════════════════════════════════════════════ */

    function buildRoster() {
        if (_filtered.length === 0) {
            return `
            <div class="um-empty">
                <div class="um-empty__icon">◎</div>
                <div class="um-empty__title">No operators match the current filter</div>
                <div class="um-empty__sub">Adjust your search or filter criteria.</div>
            </div>
            `;
        }

        const rows = _filtered.map(u => buildRow(u)).join('');

        return `
        <div class="um-table-wrap">
            <div class="um-table-head">
                <div class="um-col um-col--dot"></div>
                <div class="um-col um-col--id">OPERATOR ID</div>
                <div class="um-col um-col--handle">HANDLE</div>
                <div class="um-col um-col--email">EMAIL</div>
                <div class="um-col um-col--role">CLEARANCE</div>
                <div class="um-col um-col--status">ACCESS STATUS</div>
                <div class="um-col um-col--region">REGION</div>
                <div class="um-col um-col--joined">PROVISIONED</div>
                <div class="um-col um-col--actions"></div>
            </div>
            <div class="um-table-body" id="um-table-body">
                ${rows}
            </div>
        </div>
        `;
    }

    function buildRow(u) {
        const cl      = clearanceFor(u.role_name);
        const sm      = statusMeta(u.verification_status);
        const isSelf  = u.user_id === _selfId();
        const joined  = u.created_at
            ? new Date(u.created_at).toLocaleDateString('en', { day:'2-digit', month:'short', year:'numeric' })
            : '—';
        const shortId = String(u.user_id || '').slice(0, 8).toUpperCase();

        /* Selects for inline role change — pre-built from _roles */
        const roleOpts = _roles.map(r => `
            <option value="${r.role_id}" ${r.role_id === u.role_id ? 'selected' : ''}>
                ${r.name}
            </option>
        `).join('');

        return `
        <div class="um-row ${isSelf ? 'um-row--self' : ''} ${u.verification_status === 'SUSPENDED' ? 'um-row--suspended' : ''}"
             data-id="${u.user_id}">
            <!-- Status dot -->
            <div class="um-col um-col--dot">
                <span class="um-dot ${sm.dot}" title="${sm.label}"></span>
            </div>

            <!-- Operator ID -->
            <div class="um-col um-col--id">
                <span class="um-mono">${shortId}</span>
                ${isSelf ? '<span class="um-self-tag">YOU</span>' : ''}
            </div>

            <!-- Handle -->
            <div class="um-col um-col--handle">
                <span class="um-handle">${esc(u.username)}</span>
            </div>

            <!-- Email -->
            <div class="um-col um-col--email">
                <span class="um-mono um-email">${esc(u.email)}</span>
            </div>

            <!-- Clearance / Role -->
            <div class="um-col um-col--role">
                ${isSelf
                    ? `<span class="um-cl ${cl.cls}">${cl.label} ${esc(u.role_name || '—')}</span>`
                    : `<select class="um-role-select" data-action="role" data-id="${u.user_id}">
                           ${roleOpts}
                       </select>`
                }
            </div>

            <!-- Verification status -->
            <div class="um-col um-col--status">
                <span class="um-status-badge ${sm.cls}">${sm.label}</span>
            </div>

            <!-- Region -->
            <div class="um-col um-col--region">
                <span class="um-mono">${esc(u.region_id) || '—'}</span>
            </div>

            <!-- Joined date -->
            <div class="um-col um-col--joined">
                <span class="um-mono">${joined}</span>
            </div>

            <!-- Actions -->
            <div class="um-col um-col--actions">
                ${isSelf ? '' : buildActions(u)}
            </div>
        </div>
        `;
    }

    function buildActions(u) {
        const isVerified  = u.verification_status === 'VERIFIED';
        const isSuspended = u.verification_status === 'SUSPENDED';
        return `
        <div class="um-actions" data-id="${u.user_id}">
            ${!isVerified ? `
            <button class="um-action-btn um-action-btn--verify"
                    data-action="status" data-id="${u.user_id}" data-value="VERIFIED"
                    title="Verify operator">✓</button>` : ''}
            ${!isSuspended ? `
            <button class="um-action-btn um-action-btn--suspend"
                    data-action="status" data-id="${u.user_id}" data-value="SUSPENDED"
                    title="Suspend operator">⊘</button>` : ''}
            ${isSuspended ? `
            <button class="um-action-btn um-action-btn--reinstate"
                    data-action="status" data-id="${u.user_id}" data-value="VERIFIED"
                    title="Reinstate operator">↺</button>` : ''}
            <button class="um-action-btn um-action-btn--revoke"
                    data-action="revoke" data-id="${u.user_id}"
                    title="Revoke access permanently">✕</button>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════════
       PERMISSION MATRIX
       Firewall-rule style grid: rows = all unique permission slugs,
       columns = each role.  Filled dot = role has the permission.
       Mirrors how SIEM / IAM platforms display role matrices.
    ══════════════════════════════════════════════════════════ */

    function buildPermissionMatrix() {
        if (_roles.length === 0) return '';

        /* Collect all unique slugs across all roles, sorted */
        const allSlugs = [...new Set(_roles.flatMap(r => r.permissions || []))].sort();

        /* Role columns — sorted by clearance tier */
        const sortedRoles = [..._roles].sort((a, b) => {
            const ta = clearanceFor(a.name).tier;
            const tb = clearanceFor(b.name).tier;
            return ta - tb;
        });

        const headerCells = sortedRoles.map(r => {
            const cl = clearanceFor(r.name);
            return `
            <div class="um-mx-header">
                <span class="um-cl ${cl.cls}">${cl.label}</span>
                <div class="um-mx-role-name">${esc(r.name)}</div>
                <div class="um-mx-role-count">${r.user_count} op${r.user_count !== 1 ? 's' : ''}</div>
            </div>
            `;
        }).join('');

        const rows = allSlugs.map(slug => {
            const cells = sortedRoles.map(r => {
                const has = Array.isArray(r.permissions) && r.permissions.includes(slug);
                return `<div class="um-mx-cell ${has ? 'um-mx-cell--on' : 'um-mx-cell--off'}">
                    ${has ? '●' : '○'}
                </div>`;
            }).join('');

            return `
            <div class="um-mx-row">
                <div class="um-mx-slug">${esc(slug)}</div>
                ${cells}
            </div>
            `;
        }).join('');

        return `
        <div class="um-matrix" id="um-matrix" style="display:none">
            <div class="um-matrix__header">
                <div class="um-matrix__title">Permission Matrix // Access Control Map</div>
                <div class="um-matrix__sub">
                    ● = permission granted &nbsp;·&nbsp; ○ = not granted &nbsp;·&nbsp;
                    ${allSlugs.length} permission${allSlugs.length !== 1 ? 's' : ''} across
                    ${sortedRoles.length} roles
                </div>
            </div>
            <div class="um-mx-grid" style="--role-count:${sortedRoles.length}">
                <!-- Column headers -->
                <div class="um-mx-slug um-mx-slug--head">PERMISSION SLUG</div>
                ${headerCells}
                <!-- Data rows -->
                ${rows}
            </div>
        </div>
        `;
    }

    /* ══════════════════════════════════════════════════════════
       FILTER LOGIC
    ══════════════════════════════════════════════════════════ */

    function applyFilters() {
        const q = _searchQ.trim().toLowerCase();

        _filtered = _users.filter(u => {
            if (_roleFilter && u.role_name !== _roleFilter) return false;
            if (_statusFilter && u.verification_status !== _statusFilter) return false;
            if (q) {
                const hay = [
                    u.username, u.email,
                    String(u.user_id || '').slice(0, 8)
                ].join(' ').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }

    /* ══════════════════════════════════════════════════════════
       RE-RENDER ROSTER ONLY (after filter / data change)
    ══════════════════════════════════════════════════════════ */

    function refreshRoster() {
        applyFilters();

        const statsEl    = document.getElementById('um-stat-strip');
        const controlsEl = document.getElementById('um-controls-wrap');
        const rosterEl   = document.getElementById('um-roster-wrap');
        const matrixEl   = document.getElementById('um-matrix-wrap');

        if (statsEl)    statsEl.innerHTML    = buildStatStrip();
        if (controlsEl) controlsEl.innerHTML = buildControls();
        if (rosterEl)   rosterEl.innerHTML   = buildRoster();
        if (matrixEl)   matrixEl.innerHTML   = buildPermissionMatrix();

        /* Restore matrix visibility if it was open */
        const mx = document.getElementById('um-matrix');
        if (mx && _matrixOpen) mx.style.display = 'block';

        attachTableListeners();
        attachControlListeners();

        const countEl = document.getElementById('um-result-count');
        if (countEl) countEl.textContent = `${_filtered.length} operator${_filtered.length !== 1 ? 's' : ''}`;
    }

    /* Track matrix open/closed state across refreshes */
    let _matrixOpen = false;

    /* ══════════════════════════════════════════════════════════
       MODAL BUILDERS
    ══════════════════════════════════════════════════════════ */

    function openProvisionModal() {
        const roleOptions = _roles.map(r => {
            const cl = clearanceFor(r.name);
            return `<option value="${r.name}">${cl.label} – ${r.name}</option>`;
        }).join('');

        Modal.open({
            title: 'Provision New Operator',
            body: `
            <div class="um-modal-form">
                <div class="um-modal-field">
                    <label class="um-modal-label">Handle (username)</label>
                    <input id="prov-username" class="form-input" type="text" placeholder="e.g. ranger_alpha" autocomplete="off" />
                </div>
                <div class="um-modal-field">
                    <label class="um-modal-label">Email Address</label>
                    <input id="prov-email" class="form-input" type="email" placeholder="operator@terra.io" autocomplete="off" />
                </div>
                <div class="um-modal-field">
                    <label class="um-modal-label">Temporary Password</label>
                    <input id="prov-password" class="form-input" type="password" placeholder="Min. 8 characters" autocomplete="new-password" />
                </div>
                <div class="um-modal-field">
                    <label class="um-modal-label">Clearance Level (Role)</label>
                    <select id="prov-role" class="form-input">${roleOptions}</select>
                </div>
                <div class="um-modal-note">
                    ⚠ The operator will be created with PENDING verification status and must be manually verified.
                </div>
            </div>
            `,
            confirmLabel: 'PROVISION',
            onConfirm: async () => {
                const username = document.getElementById('prov-username')?.value?.trim();
                const email    = document.getElementById('prov-email')?.value?.trim();
                const password = document.getElementById('prov-password')?.value;
                const role     = document.getElementById('prov-role')?.value;

                if (!username || !email || !password) {
                    Toast.error('Handle, email, and password are required.');
                    return;
                }
                if (password.length < 8) {
                    Toast.error('Password must be at least 8 characters.');
                    return;
                }

                try {
                    await API.post('/auth/register', { username, email, password, role });
                    Toast.success(`Operator "${username}" provisioned. Status: PENDING.`);
                    await reloadData();
                    refreshRoster();
                } catch (err) {
                    Toast.error(err.message);
                }
            },
        });
    }

    function openRevokeModal(userId) {
        const user = _users.find(u => u.user_id === userId);
        if (!user) return;

        Modal.open({
            title: 'Revoke Operator Access',
            body: `
            <div class="um-modal-form">
                <div class="um-revoke-warning">
                    <div class="um-revoke-warning__icon">⚠</div>
                    <p>This will <strong>permanently delete</strong> operator
                    <span class="um-mono">${esc(user.username)}</span>
                    and revoke all system access. This action cannot be undone.</p>
                </div>
                <div class="um-modal-field" style="margin-top:var(--sp-4)">
                    <label class="um-modal-label">Type the handle to confirm</label>
                    <input id="revoke-confirm-input" class="form-input" type="text"
                           placeholder="${esc(user.username)}" autocomplete="off" />
                </div>
            </div>
            `,
            confirmLabel: 'REVOKE ACCESS',
            onConfirm: async () => {
                const typed = document.getElementById('revoke-confirm-input')?.value?.trim();
                if (typed !== user.username) {
                    Toast.error('Handle does not match. Revocation cancelled.');
                    return;
                }
                try {
                    await API.delete(`/users/${userId}`);
                    Toast.success(`Access revoked for "${user.username}".`);
                    await reloadData();
                    refreshRoster();
                } catch (err) {
                    Toast.error(err.message);
                }
            },
        });
    }

    /* ══════════════════════════════════════════════════════════
       EVENT LISTENERS
    ══════════════════════════════════════════════════════════ */

    function attachControlListeners() {
        document.getElementById('um-search')?.addEventListener('input', e => {
            _searchQ = e.target.value;
            applyFilters();
            const bodyEl = document.getElementById('um-table-body');
            if (bodyEl) bodyEl.innerHTML = _filtered.map(u => buildRow(u)).join('');
            const countEl = document.getElementById('um-result-count');
            if (countEl) countEl.textContent = `${_filtered.length} operator${_filtered.length !== 1 ? 's' : ''}`;
            attachTableListeners();
        });

        document.getElementById('um-filter-role')?.addEventListener('change', e => {
            _roleFilter = e.target.value;
            applyFilters();
            const bodyEl = document.getElementById('um-table-body');
            if (bodyEl) bodyEl.innerHTML = _filtered.map(u => buildRow(u)).join('');
            const countEl = document.getElementById('um-result-count');
            if (countEl) countEl.textContent = `${_filtered.length} operator${_filtered.length !== 1 ? 's' : ''}`;
            attachTableListeners();
        });

        document.getElementById('um-filter-status')?.addEventListener('change', e => {
            _statusFilter = e.target.value;
            applyFilters();
            const bodyEl = document.getElementById('um-table-body');
            if (bodyEl) bodyEl.innerHTML = _filtered.map(u => buildRow(u)).join('');
            const countEl = document.getElementById('um-result-count');
            if (countEl) countEl.textContent = `${_filtered.length} operator${_filtered.length !== 1 ? 's' : ''}`;
            attachTableListeners();
        });

        document.getElementById('btn-provision')?.addEventListener('click', openProvisionModal);

        document.getElementById('btn-toggle-matrix')?.addEventListener('click', () => {
            const mx = document.getElementById('um-matrix');
            if (!mx) return;
            _matrixOpen = !_matrixOpen;
            mx.style.display = _matrixOpen ? 'block' : 'none';
            const btn = document.getElementById('btn-toggle-matrix');
            if (btn) btn.classList.toggle('active', _matrixOpen);
        });
    }

    function attachTableListeners() {
        const body = document.getElementById('um-table-body');
        if (!body) return;

        /* Inline role select */
        body.querySelectorAll('.um-role-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                const userId   = sel.dataset.id;
                const roleId   = e.target.value;
                const roleName = e.target.options[e.target.selectedIndex].text.trim();
                try {
                    await API.patch(`/users/${userId}/role`, { role_id: roleId });
                    Toast.success(`Clearance updated to ${roleName}.`);
                    /* Update local state to avoid a full reload */
                    const u = _users.find(x => x.user_id === userId);
                    if (u) { u.role_id = roleId; u.role_name = roleName; }
                } catch (err) {
                    Toast.error(err.message);
                    /* Revert select to previous value */
                    await reloadData();
                    refreshRoster();
                }
            });
        });

        /* Status change + revoke action buttons */
        body.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action;
                const userId = btn.dataset.id;

                if (action === 'revoke') {
                    openRevokeModal(userId);
                    return;
                }

                if (action === 'status') {
                    const newStatus = btn.dataset.value;
                    const u = _users.find(x => x.user_id === userId);
                    const handle = u?.username || userId;
                    const label  = newStatus === 'VERIFIED'  ? 'Verify'
                                 : newStatus === 'SUSPENDED' ? 'Suspend'
                                 : 'Reinstate';
                    try {
                        await API.patch(`/users/${userId}/status`, { status: newStatus });
                        Toast.success(`${label}d operator "${handle}".`);
                        if (u) u.verification_status = newStatus;
                        /* Re-render just this row */
                        const rowEl = document.querySelector(`.um-row[data-id="${userId}"]`);
                        if (rowEl && u) {
                            rowEl.outerHTML = buildRow(u);
                            attachTableListeners();
                        }
                    } catch (err) {
                        Toast.error(err.message);
                    }
                }
            });
        });
    }

    /* ══════════════════════════════════════════════════════════
       DATA LOADING
    ══════════════════════════════════════════════════════════ */

    async function reloadData() {
        [_users, _roles] = await Promise.all([
            API.get('/users'),
            API.get('/users/roles'),
        ]);
        applyFilters();
    }

    /* ══════════════════════════════════════════════════════════
       PUBLIC ENTRY POINT
    ══════════════════════════════════════════════════════════ */

    async function render(container) {
        /* Permission guard — this page requires manage_users */
        if (!Auth.hasPermission('manage_users')) {
            container.innerHTML = `
            <div class="um-page">
                <div class="page-header">
                    <h1>Operator Management</h1>
                    <p>Access denied: requires <code>manage_users</code> permission.</p>
                </div>
            </div>`;
            return;
        }

        /* Loading skeleton */
        container.innerHTML = `
        <div class="um-page anim-fade-in">
            <div class="um-hero">
                <div class="um-hero__left">
                    <div class="um-hero__eyebrow">Terra // Access Control</div>
                    <h1 class="um-hero__title">Operator<br>Management</h1>
                </div>
                <div class="um-hero__right">
                    <div class="spinner"></div>
                </div>
            </div>
            <div style="padding:var(--sp-8);color:var(--clr-text-muted);display:flex;align-items:center;gap:var(--sp-3)">
                <div class="spinner"></div> Loading operator roster…
            </div>
        </div>
        `;

        try {
            await reloadData();
        } catch (err) {
            container.innerHTML = `
            <div class="um-page">
                <div class="page-header"><h1>Operator Management</h1></div>
                <div class="card" style="padding:var(--sp-8);text-align:center">
                    <p class="form-error">Failed to load roster: ${err.message}</p>
                </div>
            </div>`;
            return;
        }

        /* Full render */
        container.innerHTML = `
        <div class="um-page anim-fade-in">

            <!-- Hero -->
            <div class="um-hero">
                <div class="um-hero__left">
                    <div class="um-hero__eyebrow">Terra // Access Control Layer</div>
                    <h1 class="um-hero__title">Operator<br>Management</h1>
                </div>
                <div class="um-hero__right">
                    <div class="um-hero__desc">
                        Manage operator clearance levels, verify field personnel,<br>
                        suspend compromised accounts, and provision new operators.
                    </div>
                </div>
            </div>

            <!-- Stat strip -->
            <div id="um-stat-strip">${buildStatStrip()}</div>

            <!-- Controls -->
            <div id="um-controls-wrap" class="um-controls-wrap">${buildControls()}</div>

            <!-- Roster -->
            <div id="um-roster-wrap" class="um-roster-wrap">${buildRoster()}</div>

            <!-- Permission matrix (hidden by default) -->
            <div id="um-matrix-wrap">${buildPermissionMatrix()}</div>

        </div>
        `;

        attachControlListeners();
        attachTableListeners();
    }

    return { render };
})();
