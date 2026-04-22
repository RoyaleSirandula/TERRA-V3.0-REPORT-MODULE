/* ============================================================
   TERRA – customScrollbar.js
   Overlay scrollbar: fixed-position thumb, proportional sizing,
   fade-in on hover/scroll, drag support, theme-aware.
   ============================================================ */

const CustomScrollbar = (() => {

    const TARGETS = [
        '.main-content',
        '.sidebar',
        '.widget__body',
        '.sa-dock__panel',
        '.sa-dock__drawer',
    ];

    const instances = new Map();

    /* ── Inject CSS to hide native scrollbars on targeted elements ── */
    function injectHideStyle() {
        const selList = TARGETS.join(',\n        ');
        const wkList  = TARGETS.map(s => `${s}::-webkit-scrollbar`).join(',\n        ');
        const style   = document.createElement('style');
        style.textContent = `
        ${selList} {
            scrollbar-width: none;
            -ms-overflow-style: none;
        }
        ${wkList} {
            display: none;
        }
        `;
        document.head.appendChild(style);
    }

    /* ── ScrollbarInstance ────────────────────────────────────────── */
    class ScrollbarInstance {
        constructor(el) {
            this.el          = el;
            this.track       = null;
            this.thumb       = null;
            this.fadeTimer   = null;
            this.isDragging  = false;
            this.dragStartY  = 0;
            this.dragStartSc = 0;
            this._build();
            this._bind();
        }

        /* -- helpers -------------------------------------------- */
        _isLight() { return document.body.classList.contains('light'); }

        _thumbColor(hover = false) {
            return this._isLight()
                ? (hover ? 'rgba(0,0,0,0.34)' : 'rgba(0,0,0,0.18)')
                : (hover ? 'rgba(255,255,255,0.40)' : 'rgba(255,255,255,0.22)');
        }

        _needsScroll() {
            return this.el.scrollHeight > this.el.clientHeight + 2;
        }

        /* -- DOM construction ----------------------------------- */
        _build() {
            this.track = document.createElement('div');
            Object.assign(this.track.style, {
                position:   'fixed',
                width:      '4px',
                borderRadius: '2px',
                pointerEvents: 'none',
                zIndex:     '9998',
                opacity:    '0',
                transition: 'opacity 0.18s ease',
            });

            this.thumb = document.createElement('div');
            Object.assign(this.thumb.style, {
                position:   'absolute',
                left:       '0',
                width:      '100%',
                minHeight:  '32px',
                borderRadius: '2px',
                pointerEvents: 'auto',
                cursor:     'grab',
                background: this._thumbColor(false),
                transition: 'background 0.15s ease',
            });

            this.track.appendChild(this.thumb);
            document.body.appendChild(this.track);
            this._reposition();
        }

        /* -- Geometry ------------------------------------------- */
        _reposition() {
            const el     = this.el;
            const rect   = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const trackH  = rect.height - 4;
            const scrollH = el.scrollHeight;
            const clientH = el.clientHeight;
            const ratio   = clientH / scrollH;
            const thumbH  = Math.max(32, trackH * ratio);
            const maxScr  = scrollH - clientH;
            const pct     = maxScr > 0 ? el.scrollTop / maxScr : 0;
            const thumbY  = pct * (trackH - thumbH);

            Object.assign(this.track.style, {
                top:    `${rect.top + 2}px`,
                left:   `${rect.right - 5}px`,
                height: `${trackH}px`,
            });
            Object.assign(this.thumb.style, {
                height: `${thumbH}px`,
                top:    `${thumbY}px`,
            });
        }

        /* -- Visibility ----------------------------------------- */
        _show() {
            if (!this._needsScroll()) return;
            clearTimeout(this.fadeTimer);
            this._reposition();
            this.track.style.opacity       = '1';
            this.track.style.pointerEvents = 'auto';
        }

        _scheduleHide() {
            clearTimeout(this.fadeTimer);
            this.fadeTimer = setTimeout(() => {
                if (!this.isDragging) {
                    this.track.style.opacity       = '0';
                    this.track.style.pointerEvents = 'none';
                }
            }, 1200);
        }

        /* -- Event binding -------------------------------------- */
        _bind() {
            const el = this.el;

            this._onScroll  = ()  => { this._show(); this._scheduleHide(); };
            this._onEnter   = ()  => this._show();
            this._onLeave   = ()  => { if (!this.isDragging) this._scheduleHide(); };

            el.addEventListener('scroll',     this._onScroll, { passive: true });
            el.addEventListener('mouseenter', this._onEnter);
            el.addEventListener('mouseleave', this._onLeave);

            /* Drag on thumb */
            this._onThumbDown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isDragging  = true;
                this.dragStartY  = e.clientY;
                this.dragStartSc = el.scrollTop;
                this.thumb.style.cursor          = 'grabbing';
                document.body.style.userSelect   = 'none';
            };

            this._onDocMove = (e) => {
                if (!this.isDragging) return;
                const rect   = el.getBoundingClientRect();
                const trackH = rect.height - 4;
                const thumbH = Math.max(32, trackH * (el.clientHeight / el.scrollHeight));
                const maxTop = trackH - thumbH;
                const maxScr = el.scrollHeight - el.clientHeight;
                const dy     = e.clientY - this.dragStartY;
                el.scrollTop = this.dragStartSc + (dy / maxTop) * maxScr;
                this._reposition();
            };

            this._onDocUp = () => {
                if (!this.isDragging) return;
                this.isDragging                  = false;
                this.thumb.style.cursor          = 'grab';
                document.body.style.userSelect   = '';
                this._scheduleHide();
            };

            this.thumb.addEventListener('mousedown', this._onThumbDown);
            document.addEventListener('mousemove',  this._onDocMove);
            document.addEventListener('mouseup',    this._onDocUp);

            /* Thumb hover tint */
            this.thumb.addEventListener('mouseenter', () => {
                this.thumb.style.background = this._thumbColor(true);
            });
            this.thumb.addEventListener('mouseleave', () => {
                if (!this.isDragging) this.thumb.style.background = this._thumbColor(false);
            });

            /* Theme change */
            this._onTheme = () => {
                this.thumb.style.background = this._thumbColor(false);
            };
            window.addEventListener('terra:themechange', this._onTheme);

            /* Window + element resize */
            this._onResize = () => this._reposition();
            window.addEventListener('resize', this._onResize);

            this._ro = new ResizeObserver(() => this._reposition());
            this._ro.observe(el);
        }

        /* -- Teardown ------------------------------------------- */
        destroy() {
            clearTimeout(this.fadeTimer);
            const el = this.el;
            el.removeEventListener('scroll',     this._onScroll);
            el.removeEventListener('mouseenter', this._onEnter);
            el.removeEventListener('mouseleave', this._onLeave);
            document.removeEventListener('mousemove', this._onDocMove);
            document.removeEventListener('mouseup',   this._onDocUp);
            window.removeEventListener('resize',           this._onResize);
            window.removeEventListener('terra:themechange', this._onTheme);
            this._ro.disconnect();
            if (this.track.parentNode) this.track.remove();
        }
    }

    /* ── Attach to all matching elements ──────────────────────────── */
    function attachAll() {
        /* Clean up instances whose elements left the DOM */
        for (const [el, inst] of instances) {
            if (!document.contains(el)) {
                inst.destroy();
                instances.delete(el);
            }
        }
        /* Attach to new matching elements */
        TARGETS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (!instances.has(el)) {
                    instances.set(el, new ScrollbarInstance(el));
                }
            });
        });
    }

    /* ── MutationObserver — auto-attach when new elements appear ──── */
    function _watchDOM() {
        const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const hit = TARGETS.some(sel =>
                        node.matches?.(sel) || node.querySelector?.(sel)
                    );
                    if (hit) { attachAll(); return; }
                }
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    /* ── Public: initialise once ──────────────────────────────────── */
    function init() {
        injectHideStyle();
        attachAll();
        _watchDOM();
    }

    return { init, attachAll };
})();
