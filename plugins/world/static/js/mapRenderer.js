class MapRenderer {
    constructor(canvas, world) {
        this.canvas = canvas;
        this.world = world;

        this._onNpcClick = null;
        this._onLocationClick = null;
        this.npcStates = [];
        this._npcRenderPos = {};
        this._simulationSpeed = 1;
        this._lastSnapshotAtMs = performance.now();
        this._npcInterp = {};
        this._avatarCache = {};
        this._animationHandle = null;

        this._tx = 0;
        this._ty = 0;
        this._scale = 1;

        this._initCanvas();
        this._fitToCanvas();
        this._generateTerrain();
        this._generateDecorations();
        this._registerEvents();
        this._startAnimationLoop();
    }

    _initCanvas() {
        this._dpr = window.devicePixelRatio || 1;
        this._ctx = this.canvas.getContext("2d");
        this._applyDpr();
    }

    _applyDpr() {
        const cssW = parseInt(this.canvas.style.width, 10) || this.canvas.width || 800;
        const cssH = parseInt(this.canvas.style.height, 10) || this.canvas.height || 600;
        this._dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(cssW * this._dpr);
        this.canvas.height = Math.round(cssH * this._dpr);
        this.canvas.style.width = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;
        this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        this._cssW = cssW;
        this._cssH = cssH;
    }

    _fitToCanvas() {
        const blocks = this.world.cityBlocks || [];
        const locs = this.world.locations || [];
        let minX;
        let maxX;
        let minY;
        let maxY;

        if (blocks.length) {
            const points = [];
            for (const block of blocks) {
                if (Array.isArray(block.points) && block.points.length) {
                    for (const point of block.points) points.push(point);
                } else {
                    points.push({ x: block.x, y: block.y });
                    points.push({ x: block.x + block.w, y: block.y + block.h });
                }
            }
            minX = Math.min(...points.map((p) => p.x));
            maxX = Math.max(...points.map((p) => p.x));
            minY = Math.min(...points.map((p) => p.y));
            maxY = Math.max(...points.map((p) => p.y));
        } else if (locs.length) {
            minX = Math.min(...locs.map((l) => l.x)) - 60;
            maxX = Math.max(...locs.map((l) => l.x)) + 60;
            minY = Math.min(...locs.map((l) => l.y)) - 60;
            maxY = Math.max(...locs.map((l) => l.y)) + 60;
        } else {
            return;
        }

        const pad = 40;
        const sx = (this._cssW - pad * 2) / Math.max(1, maxX - minX);
        const sy = (this._cssH - pad * 2) / Math.max(1, maxY - minY);
        this._scale = Math.min(sx, sy, 2.5);
        this._tx = pad + (this._cssW - pad * 2 - (maxX - minX) * this._scale) / 2 - minX * this._scale;
        this._ty = pad + (this._cssH - pad * 2 - (maxY - minY) * this._scale) / 2 - minY * this._scale;
        this._bounds = {
            minX: minX !== undefined ? minX : 0,
            maxX: maxX !== undefined ? maxX : 800,
            minY: minY !== undefined ? minY : 0,
            maxY: maxY !== undefined ? maxY : 600,
            w: (maxX - minX) || 800,
            h: (maxY - minY) || 600
        };
    }

    _districtColor(type) {
        return {
            residential: "#cee3b3",
            commercial: "#e6dfcd",
            nature: "#aed994",
            school: "#c9ddba",
            entertainment: "#e6d6c3",
        }[type] || "#cee3b3";
    }

    _buildingFill(type) {
        return {
            house: "#d88062",
            cafe: "#cf675e",
            shop: "#6997b0",
            park: "#9ad177",
            shrine: "#75635b",
            school: "#86a695",
            library: "#a88b6b",
            gym: "#d4a373",
            arcade: "#846bb1",
            hospital: "#e6f2f2",
        }[type] || "#a0a4a8";
    }

    _buildingStroke(type) {
        return {
            house: "#a65e45",
            cafe: "#9e4840",
            shop: "#4a7187",
            park: "#719c53",
            shrine: "#4a3c36",
            school: "#5d7568",
            library: "#786045",
            gym: "#9e774f",
            arcade: "#594380",
            hospital: "#accad1",
        }[type] || "#707070";
    }

    _npcActivityColor(activity) {
        return {
            eat: "#ff6f00",
            sleep: "#1565c0",
            socialize: "#c2185b",
            relax: "#2e7d32",
            walk: "#f9a825",
            run: "#ef5350",
            idle: "#9e9e9e",
            wander: "#bdbdbd",
        }[activity] || "#9e9e9e";
    }

    _districtLabelColor(type) {
        return {
            residential: "#3a5640",
            commercial: "#5b4c20",
            nature: "#1e6d22",
            school: "#0555b0",
            entertainment: "#6b1030",
        }[type] || "#444444";
    }

    _draw() {
        const ctx = this._ctx;
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.fillStyle = "#bcdf9b";
        ctx.fillRect(0, 0, this._cssW, this._cssH);

        ctx.save();
        ctx.translate(this._tx, this._ty);
        ctx.scale(this._scale, this._scale);

        this._drawGround(ctx);
        this._drawTerrain(ctx);
        this._drawDecals(ctx);
        this._drawRoads(ctx);
        this._drawBuildings(ctx);
        this._drawBridges(ctx);
        this._drawDecorations(ctx); // Trees overlapping buildings & roads
        this._drawTimeOfDayAndGlows(ctx); // Light up buildings and time overlay

        this._drawBuildingLabels(ctx);
        this._drawNpcs(ctx);
        this._drawLabels(ctx);

        ctx.restore();
    }

    _generateDecorations() {
        this._decorations = [];
        if (!this.world) return;
        this._seed = this.world.seed || 12345;
        const random = () => {
            this._seed = (this._seed * 9301 + 49297) % 233280;
            return this._seed / 233280;
        };

        const colors = ["#fcaec1", "#fff1e1", "#e0e3e8"];
        const streets = this.world.streets || [];
        const locs = this.world.locations || [];

        const distToSegment = (p, v, w) => {
            const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
            if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
            let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
            t = Math.max(0, Math.min(1, t));
            return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
        };

        const isValidTreeSpot = (tx, ty) => {
            for (const st of streets) {
                if (!st.pts || st.pts.length < 2) continue;
                for (let j = 0; j < st.pts.length - 1; j++) {
                    if (distToSegment({ x: tx, y: ty }, st.pts[j], st.pts[j + 1]) < 18) return false;
                }
            }
            for (const loc of locs) {
                if (loc.type === "park" || loc.type === "shrine") continue;
                const bx = loc.bx !== undefined ? loc.bx : loc.x;
                const by = loc.by !== undefined ? loc.by : loc.y;
                if (tx >= bx - 8 && tx <= bx + loc.bw + 8 && ty >= by - 8 && ty <= by + loc.bh + 8) return false;
            }
            for (const riv of this._rivers || []) {
                if (!riv || riv.length < 2) continue;
                for (let j = 0; j < riv.length - 1; j++) {
                    if (distToSegment({ x: tx, y: ty }, riv[j], riv[j + 1]) < 18) return false;
                }
            }
            for (const lake of this._lakes || []) {
                if (!lake || !lake.length) continue;
                let lcx = 0, lcy = 0;
                for (const p of lake) { lcx += p.x; lcy += p.y; }
                lcx /= lake.length; lcy /= lake.length;
                if (Math.hypot(tx - lcx, ty - lcy) < 45) return false;
            }
            return true;
        };

        const addTreeGroup = (cx, cy, count, spread, treeStyle, skipCheck = false) => {
            let placed = 0;
            let attempts = 0;
            while (placed < count && attempts < count * 3) {
                attempts++;
                const r = 3.5 + random() * 4.0;
                const x = cx + (random() - 0.5) * spread;
                const y = cy + (random() - 0.5) * spread;

                if (!skipCheck && !isValidTreeSpot(x, y)) continue;

                let type = treeStyle;
                let color = null;
                const randMod = random();
                if (randMod > 0.90) {
                    type = "dots";
                    color = colors[Math.floor(random() * colors.length)];
                } else if (randMod > 0.75) {
                    type = "grass";
                }

                this._decorations.push({ x, y, r, type, color });
                placed++;
            }
        };

        // Trees along streets
        for (const st of streets) {
            if (!st.pts || st.pts.length < 2) continue;
            for (let i = 0; i < st.pts.length - 1; i++) {
                const p0 = st.pts[i], p1 = st.pts[i + 1];
                const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                const count = Math.floor(dist / 22);
                if (count <= 0) continue;
                const nx = (p1.y - p0.y) / dist;
                const ny = -(p1.x - p0.x) / dist;

                for (let j = 1; j <= count; j++) {
                    if (random() > 0.6) continue;
                    const t = j / (count + 1);
                    const cx = p0.x + (p1.x - p0.x) * t;
                    const cy = p0.y + (p1.y - p0.y) * t;
                    const offset = 18 + random() * 4;
                    const style = random() > 0.5 ? "sakura_tree" : "green_tree";
                    if (random() > 0.4) addTreeGroup(cx + nx * offset, cy + ny * offset, 1, 4, style, false);
                    if (random() > 0.4) addTreeGroup(cx - nx * offset, cy - ny * offset, 1, 4, style, false);
                }
            }
        }

        // Scatter in districts:
        for (const block of this.world.cityBlocks || []) {
            let density = 0.00003;
            let treeStyle = "green_tree";

            if (block.districtType === "nature") { density = 0.0002; treeStyle = "pine_tree"; }
            else if (block.districtType === "entertainment") { density = 0.0001; treeStyle = "sakura_tree"; }
            else if (block.districtType === "residential") { density = 0.0001; treeStyle = random() > 0.5 ? "sakura_tree" : "green_tree"; }
            else if (block.districtType === "school") treeStyle = "sakura_tree";

            const area = block.w * block.h;
            const count = Math.floor(area * density);
            for (let i = 0; i < count; i++) {
                const tx = block.x + random() * block.w;
                const ty = block.y + random() * block.h;
                addTreeGroup(tx, ty, 1 + Math.floor(random() * 2), 12, treeStyle);
            }
        }

        // Scatter tightly around properties
        for (const loc of this.world.locations || []) {
            const { x, y, bw, bh, type } = loc;

            if (type === "shrine") {
                this._decorations.push({ x: x, y: y + bh / 2 + 8, r: 12, type: "torii" });
                addTreeGroup(x, y, 6 + Math.floor(random() * 4), Math.max(bw, bh) * 1.5, "pine_tree", true);
            } else if (type === "school") {
                addTreeGroup(x, y, 8 + Math.floor(random() * 5), Math.max(bw, bh) * 1.3, "sakura_tree", true);
            } else if (type === "park") {
                addTreeGroup(x, y, 12 + Math.floor(random() * 6), Math.max(bw, bh) * 0.9, "green_tree", true);
                addTreeGroup(x, y, 6, Math.max(bw, bh), "sakura_tree", true);
            } else {
                if (random() > 0.5) {
                    const style = random() > 0.5 ? "sakura_tree" : "green_tree";
                    addTreeGroup(x, y, 1 + Math.floor(random() * 2), Math.max(bw, bh) * 1.1, style, false);
                }
            }
        }

        // Sort decorations by Y to create pseudo-depth
        this._decorations.sort((a, b) => a.y - b.y);
    }

    _drawDecorations(ctx) {
        if (!this._decorations) return;
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Pass 1: Outlines for Contiguous Trees
        for (const dec of this._decorations) {
            if (dec.type.endsWith("_tree")) {
                const strokeColor = dec.type === "sakura_tree" ? "#c77f92" : (dec.type === "pine_tree" ? "#33542d" : "#547947");
                ctx.beginPath();
                ctx.arc(dec.x, dec.y, dec.r + 1.2 * scaleFactor, 0, Math.PI * 2);
                ctx.fillStyle = strokeColor;
                ctx.fill();
            }
        }

        // Pass 2: Fills for Contiguous Trees
        for (const dec of this._decorations) {
            if (dec.type.endsWith("_tree")) {
                const fillColor = dec.type === "sakura_tree" ? "#fcaec1" : (dec.type === "pine_tree" ? "#588550" : "#88b577");
                ctx.beginPath();
                ctx.arc(dec.x, dec.y, dec.r, 0, Math.PI * 2);
                ctx.fillStyle = fillColor;
                ctx.fill();
            }
        }

        // Pass 3: Highlights and other decorations
        for (const dec of this._decorations) {
            if (dec.type.endsWith("_tree")) {
                const highColor = dec.type === "sakura_tree" ? "#ffd0da" : (dec.type === "pine_tree" ? "#6b9c62" : "#a3cd94");
                ctx.beginPath();
                ctx.arc(dec.x - dec.r * 0.25, dec.y - dec.r * 0.25, dec.r * 0.5, 0, Math.PI * 2);
                ctx.fillStyle = highColor;
                ctx.fill();
            } else if (dec.type === "torii") {
                const s = dec.r;
                ctx.fillStyle = "#d14b43";
                // Pillars
                ctx.fillRect(dec.x - s * 0.4, dec.y - s * 0.3, s * 0.15, s * 0.9);
                ctx.fillRect(dec.x + s * 0.25, dec.y - s * 0.3, s * 0.15, s * 0.9);
                // Beams
                ctx.fillRect(dec.x - s * 0.5, dec.y - s * 0.1, s * 1.0, s * 0.15);
                ctx.fillRect(dec.x - s * 0.6, dec.y - s * 0.4, s * 1.2, s * 0.2);
            }
        }
    }

    _drawDecals(ctx) {
        if (!this._decorations) return;
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const dec of this._decorations) {
            if (dec.type === "dots") {
                ctx.fillStyle = dec.color;
                ctx.beginPath();
                ctx.arc(dec.x, dec.y, 1.2, 0, Math.PI * 2);
                ctx.fill();
            } else if (dec.type === "grass") {
                ctx.strokeStyle = "#9dc779";
                ctx.lineWidth = 1 * scaleFactor;
                ctx.beginPath();
                ctx.moveTo(dec.x - 2, dec.y - 1);
                ctx.lineTo(dec.x, dec.y + 2);
                ctx.lineTo(dec.x + 2, dec.y - 1);
                ctx.stroke();
            }
        }
    }

    _generateTerrain() {
        this._lakes = [];
        this._rivers = [];
        this._bridges = [];
        if (!this.world || !this._bounds) return;

        this._seed = this.world.seed || 12345;
        const random = () => {
            this._seed = (this._seed * 9301 + 49297) % 233280;
            return this._seed / 233280;
        };

        const { minX, maxX, minY, maxY, w, h } = this._bounds;

        // Find intersections
        const ptMap = new Map();
        const streets = this.world.streets || [];
        const locs = this.world.locations || [];
        for (const st of streets) {
            if (!st.pts) continue;
            for (let i = 0; i < st.pts.length; i++) {
                const px = Math.round(st.pts[i].x);
                const py = Math.round(st.pts[i].y);
                const key = `${px},${py}`;
                ptMap.set(key, (ptMap.get(key) || 0) + (i === 0 || i === st.pts.length - 1 ? 1 : 2));
            }
        }
        const crossRoads = [];
        for (const [key, val] of ptMap.entries()) {
            if (val > 2) {
                const [x, y] = key.split(",");
                crossRoads.push({ x: parseInt(x), y: parseInt(y) });
            }
        }
        this._intersections = crossRoads;

        const distToSegment = (px, py, vx, vy, wx, wy) => {
            const l2 = (wx - vx) ** 2 + (wy - vy) ** 2;
            if (l2 === 0) return Math.hypot(px - vx, py - vy);
            let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
            t = Math.max(0, Math.min(1, t));
            const nx = vx + t * (wx - vx);
            const ny = vy + t * (wy - vy);
            return Math.hypot(px - nx, py - ny);
        };

        let bestRiverPts = [];
        let bestBridges = [];
        let bestScore = -999999;

        // 1. River Generation via Monte Carlo search
        for (let attempt = 0; attempt < 25; attempt++) {
            const riverPts = [];
            const startX = minX + w * 0.1 + random() * w * 0.8;
            const endX = minX + w * 0.1 + random() * w * 0.8;

            const segments = 30; // fine resolution
            const dir = random() > 0.5 ? 1 : -1;
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const rx = startX + (endX - startX) * t + Math.sin(t * Math.PI * 2) * w * (0.05 + random() * 0.15) * dir;
                const ry = minY - 50 + (h + 100) * t;
                riverPts.push({ x: rx, y: ry });
            }

            // Relax
            for (let k = 0; k < 12; k++) {
                for (let i = 1; i < riverPts.length - 1; i++) {
                    const pt = riverPts[i];
                    for (const loc of locs) {
                        const bx = loc.bx !== undefined ? loc.bx : loc.x;
                        const by = loc.by !== undefined ? loc.by : loc.y;
                        const cx = bx + loc.bw / 2;
                        const cy = by + loc.bh / 2;
                        const r = Math.max(loc.bw, loc.bh) * 0.7 + 25;
                        const dx = pt.x - cx;
                        const dy = pt.y - cy;
                        const dist = Math.hypot(dx, dy);
                        if (dist < r && dist > 0) {
                            pt.x += (dx / dist) * (r - dist) * 0.4;
                        }
                    }
                    for (const cr of crossRoads) {
                        const dx = pt.x - cr.x;
                        const dy = pt.y - cr.y;
                        const dist = Math.hypot(dx, dy);
                        if (dist < 45 && dist > 0) {
                            pt.x += (dx / dist) * (45 - dist) * 0.5;
                        }
                    }
                    const avgX = (riverPts[i - 1].x + riverPts[i + 1].x) / 2;
                    pt.x += (avgX - pt.x) * 0.35;
                }
            }

            // Evaluate
            let score = 0;
            const bridges = [];

            for (const st of streets) {
                if (!st.pts || st.pts.length < 2) continue;
                for (let i = 0; i < st.pts.length - 1; i++) {
                    const p0 = st.pts[i], p1 = st.pts[i + 1];
                    for (let j = 0; j < riverPts.length - 1; j++) {
                        const r0 = riverPts[j], r1 = riverPts[j + 1];
                        const s1_x = p1.x - p0.x, s1_y = p1.y - p0.y;
                        const s2_x = r1.x - r0.x, s2_y = r1.y - r0.y;
                        const det = -s2_x * s1_y + s1_x * s2_y;
                        if (Math.abs(det) >= 0.001) {
                            const s = (-s1_y * (p0.x - r0.x) + s1_x * (p0.y - r0.y)) / det;
                            const t = (s2_x * (p0.y - r0.y) - s2_y * (p0.x - r0.x)) / det;
                            if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
                                if (st.type === "stub") score -= 500;
                                const ix = p0.x + (t * s1_x);
                                const iy = p0.y + (t * s1_y);
                                for (const cr of crossRoads) {
                                    if (Math.hypot(ix - cr.x, iy - cr.y) < 50) score -= 300;
                                }
                                bridges.push({ x: ix, y: iy, angle: Math.atan2(s1_y, s1_x), type: st.type || 'local' });
                            }
                        }
                    }
                }
            }

            for (const pt of riverPts) {
                for (const st of streets) {
                    if (!st.pts || st.pts.length < 2) continue;
                    for (let i = 0; i < st.pts.length - 1; i++) {
                        const dist = distToSegment(pt.x, pt.y, st.pts[i].x, st.pts[i].y, st.pts[i + 1].x, st.pts[i + 1].y);
                        if (dist < 15) score -= 10;
                    }
                }
                for (const loc of locs) {
                    const bx = loc.bx !== undefined ? loc.bx : loc.x;
                    const by = loc.by !== undefined ? loc.by : loc.y;
                    const cx = bx + loc.bw / 2;
                    const cy = by + loc.bh / 2;
                    if (Math.hypot(pt.x - cx, pt.y - cy) < Math.max(loc.bw, loc.bh) * 0.5 + 5) score -= 200;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestRiverPts = riverPts;
                bestBridges = bridges;
            }
            if (score === 0) break;
        }

        if (bestRiverPts.length) this._rivers.push(bestRiverPts);
        this._bridges = bestBridges;

        // 2. Lakes (avoiding buildings and roads)
        for (let i = 0; i < 6; i++) {
            const lx = minX + random() * w;
            const ly = minY + random() * h;

            let valid = true;
            for (const loc of this.world.locations || []) {
                const bx = loc.bx !== undefined ? loc.bx : loc.x;
                const by = loc.by !== undefined ? loc.by : loc.y;
                if (Math.hypot(bx + loc.bw / 2 - lx, by + loc.bh / 2 - ly) < Math.max(loc.bw, loc.bh) + 30) valid = false;
            }
            for (const riv of bestRiverPts.length ? [bestRiverPts] : []) {
                if (Math.hypot(riv.x - lx, riv.y - ly) < 45) valid = false;
            }
            if (valid) {
                const pts = [];
                const rBase = 20 + random() * 40;
                const pointsCount = 10;
                for (let j = 0; j < pointsCount; j++) {
                    const angle = (j / pointsCount) * Math.PI * 2;
                    const rad = rBase + (random() - 0.5) * 15;
                    pts.push({ x: lx + Math.cos(angle) * rad, y: ly + Math.sin(angle) * rad });
                }
                this._lakes.push(pts);
            }
        }
    }

    _drawTerrain(ctx) {
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        ctx.fillStyle = "#8ccfe0"; // Lake water
        ctx.strokeStyle = "#aadeeb"; // Water edge highlight
        ctx.lineWidth = 3 * scaleFactor;
        ctx.lineJoin = "round";

        for (const lake of this._lakes || []) {
            if (!lake.length) continue;
            ctx.beginPath();
            ctx.moveTo(lake[0].x, lake[0].y);
            for (let i = 1; i < lake.length; i++) ctx.lineTo(lake[i].x, lake[i].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.strokeStyle = "#8ccfe0";
        ctx.lineWidth = 18 * scaleFactor;
        ctx.lineCap = "round";
        for (const riv of this._rivers || []) {
            if (riv.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(riv[0].x, riv[0].y);
            for (let i = 1; i < riv.length; i++) ctx.lineTo(riv[i].x, riv[i].y);
            ctx.stroke();

            ctx.lineWidth = 14 * scaleFactor;
            ctx.strokeStyle = "#9cd8e8";
            ctx.stroke();
        }
    }

    _drawBridges(ctx) {
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        ctx.fillStyle = "#b59b7b";
        ctx.strokeStyle = "#6e563d";

        for (const br of this._bridges || []) {
            const w = (br.type === "arterial" ? 28 : 22) * scaleFactor;
            const l = 32 * scaleFactor;
            ctx.save();
            ctx.translate(br.x, br.y);
            ctx.rotate(br.angle);
            ctx.lineWidth = 1.5 * scaleFactor;

            ctx.fillRect(-l / 2, -w / 2, l, w);
            ctx.strokeRect(-l / 2, -w / 2, l, w);

            ctx.beginPath();
            ctx.moveTo(-l / 2 + l * 0.15, -w / 2); ctx.lineTo(-l / 2 + l * 0.15, w / 2);
            ctx.moveTo(-l / 2 + l * 0.5, -w / 2); ctx.lineTo(-l / 2 + l * 0.5, w / 2);
            ctx.moveTo(-l / 2 + l * 0.85, -w / 2); ctx.lineTo(-l / 2 + l * 0.85, w / 2);
            ctx.stroke();

            // Rails
            ctx.fillStyle = "#8a6642";
            ctx.fillRect(-l / 2, -w / 2 - 2 * scaleFactor, l, 3 * scaleFactor);
            ctx.fillRect(-l / 2, w / 2 - 1 * scaleFactor, l, 3 * scaleFactor);

            ctx.restore();
        }
    }

    _drawGround(ctx) {
        for (const block of this.world.cityBlocks || []) {
            const color = this._districtColor(block.districtType);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.45;

            let cx, cy, w, h;
            if (Array.isArray(block.points) && block.points.length >= 3) {
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const p of block.points) {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                }
                w = maxX - minX; h = maxY - minY;
                cx = minX + w / 2; cy = minY + h / 2;
            } else {
                w = block.w; h = block.h;
                cx = block.x + w / 2; cy = block.y + h / 2;
            }

            const r = Math.max(w, h) * 0.65;
            ctx.beginPath();
            ctx.arc(cx - w * 0.2, cy - h * 0.2, r * 0.8, 0, Math.PI * 2);
            ctx.arc(cx + w * 0.3, cy + h * 0.1, r * 0.7, 0, Math.PI * 2);
            ctx.arc(cx - w * 0.1, cy + h * 0.3, r * 0.9, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalAlpha = 1.0;
        }
    }

    _drawRoads(ctx) {
        const streets = this.world.streets || [];
        const frontages = [];
        for (const loc of this.world.locations || []) {
            for (const frontage of Array.isArray(loc.frontages) ? loc.frontages : []) {
                if (frontage.roadPt && frontage.edgePt) frontages.push(frontage);
            }
        }
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        const styles = {
            arterial: { fill: "#e8e0d0", border: "#6878a0", w: 14 * scaleFactor, bw: 18 * scaleFactor },
            local: { fill: "#e0dbd0", border: "#8090a8", w: 8 * scaleFactor, bw: 12 * scaleFactor },
            stub: { fill: "#d8d5ce", border: "#9098a8", w: 4 * scaleFactor, bw: 6 * scaleFactor },
        };

        const traceStreet = (street) => {
            if (!Array.isArray(street.pts) || street.pts.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(street.pts[0].x, street.pts[0].y);
            for (let i = 1; i < street.pts.length; i++) {
                ctx.lineTo(street.pts[i].x, street.pts[i].y);
            }
        };

        const traceFrontage = (frontage) => {
            ctx.beginPath();
            ctx.moveTo(frontage.roadPt.x, frontage.roadPt.y);
            ctx.lineTo(frontage.edgePt.x, frontage.edgePt.y);
        };

        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const tier of ["stub", "local", "arterial"]) {
            const style = styles[tier];
            ctx.strokeStyle = style.border;
            ctx.lineWidth = style.bw;
            for (const street of streets) {
                if (street.tier !== tier) continue;
                traceStreet(street);
                ctx.stroke();
            }
            for (const frontage of frontages) {
                if (frontage.tier !== tier) continue;
                traceFrontage(frontage);
                ctx.stroke();
            }
        }

        for (const tier of ["stub", "local", "arterial"]) {
            const style = styles[tier];
            ctx.strokeStyle = style.fill;
            ctx.lineWidth = style.w;
            for (const street of streets) {
                if (street.tier !== tier) continue;
                traceStreet(street);
                ctx.stroke();
            }
            for (const frontage of frontages) {
                if (frontage.tier !== tier) continue;
                traceFrontage(frontage);
                ctx.stroke();
            }
        }
    }

    _traceBuildingShape(ctx, loc) {
        const { bx: x, by: y, bw, bh, shape } = loc;
        if (!loc.roadClip) {
            if (shape !== undefined && loc.type !== "park") {
                const s = shape % 4;
                ctx.beginPath();
                if (s === 1 && bw > 15 && bh > 15) {
                    const cutW = bw * 0.4;
                    const cutH = bh * 0.4;
                    ctx.moveTo(x + bw, y);
                    ctx.lineTo(x + bw, y + bh);
                    ctx.lineTo(x, y + bh);
                    ctx.lineTo(x, y + cutH);
                    ctx.lineTo(x + bw - cutW, y + cutH);
                    ctx.lineTo(x + bw - cutW, y);
                    ctx.closePath();
                    return;
                } else if (s === 2 && bw > 20 && bh > 15) {
                    const cutW = bw * 0.4;
                    const cutH = bh * 0.5;
                    const midX = x + (bw - cutW) / 2;
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + bw, y);
                    ctx.lineTo(x + bw, y + bh);
                    ctx.lineTo(midX + cutW, y + bh);
                    ctx.lineTo(midX + cutW, y + bh - cutH);
                    ctx.lineTo(midX, y + bh - cutH);
                    ctx.lineTo(midX, y + bh);
                    ctx.lineTo(x, y + bh);
                    ctx.closePath();
                    return;
                } else if (s === 3 && bw > 20 && bh > 20) {
                    const insetW = bw * 0.25;
                    const insetH = bh * 0.25;
                    ctx.moveTo(x + insetW, y);
                    ctx.lineTo(x + bw - insetW, y);
                    ctx.lineTo(x + bw - insetW, y + insetH);
                    ctx.lineTo(x + bw, y + insetH);
                    ctx.lineTo(x + bw, y + bh - insetH);
                    ctx.lineTo(x + bw - insetW, y + bh - insetH);
                    ctx.lineTo(x + bw - insetW, y + bh);
                    ctx.lineTo(x + insetW, y + bh);
                    ctx.lineTo(x + insetW, y + bh - insetH);
                    ctx.lineTo(x, y + bh - insetH);
                    ctx.lineTo(x, y + insetH);
                    ctx.lineTo(x + insetW, y + insetH);
                    ctx.closePath();
                    return;
                }
            }

            this._roundRect(ctx, x, y, bw, bh, 2);
            return;
        }

        const { nx, ny } = loc.roadClip;
        const corners = [
            { x, y },
            { x: x + bw, y },
            { x: x + bw, y: y + bh },
            { x, y: y + bh },
        ];
        const dots = corners.map((corner) => corner.x * nx + corner.y * ny);
        const minDot = Math.min(...dots);
        const maxDot = Math.max(...dots);
        const threshold = minDot + (maxDot - minDot) * 0.4;
        const cutLine = minDot + (maxDot - minDot) * 0.35;
        const poly = [];

        for (let i = 0; i < 4; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % 4];
            const da = dots[i];
            const db = dots[(i + 1) % 4];
            const aInside = da >= threshold;
            const bInside = db >= threshold;

            if (aInside) {
                poly.push(a);
            } else {
                poly.push({
                    x: a.x + nx * (cutLine - da),
                    y: a.y + ny * (cutLine - da),
                });
            }

            if (aInside !== bInside) {
                const t = (threshold - da) / (db - da);
                poly.push({
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                });
            }
        }

        if (poly.length < 3) {
            this._roundRect(ctx, x, y, bw, bh, 2);
            return;
        }

        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
    }

    _drawBuildings(ctx) {
        const iconMap = {
            cafe: "☕",
            park: "🌳",
            shop: "🏪",
            house: "🏠",
            shrine: "⛩",
            school: "🏫",
            library: "📚",
            gym: "🏋️",
            arcade: "🕹️",
            hospital: "🏥",
        };

        const houseOwners = {};
        for (const npc of this.npcStates || []) {
            if (npc.home_location && !houseOwners[npc.home_location]) {
                if (npc.name) {
                    houseOwners[npc.home_location] = `${npc.name.split(" ")[0].trim()} House`;
                }
            }
        }

        for (const loc of this.world.locations || []) {
            const { bx: x, by: y, bw, bh, type } = loc;

            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,0.18)";
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 1.5;
            ctx.shadowOffsetY = 2;
            const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
            ctx.fillStyle = this._buildingFill(type);
            ctx.strokeStyle = this._buildingStroke(type);
            ctx.lineWidth = 1 * scaleFactor;
            this._traceBuildingShape(ctx, loc);
            ctx.fill();
            ctx.restore();

            ctx.strokeStyle = this._buildingStroke(type);
            ctx.lineWidth = 1 * scaleFactor;
            this._traceBuildingShape(ctx, loc);
            ctx.stroke();

            // Add simple roof ridge line or inner detail to sell the "roof" look
            if (type !== "park") {
                ctx.save();
                ctx.strokeStyle = "rgba(255,255,255,0.15)";
                ctx.lineWidth = 1.5 * scaleFactor;
                const inset = 3;
                if (loc.shape && loc.shape !== 0 && !loc.roadClip) {
                    // Custom shapes don't get simple ridge to avoid intersecting cutouts
                } else if (bw > 10 && bh > 10) {
                    if (bw > bh) {
                        ctx.beginPath(); ctx.moveTo(x + inset, y + bh / 2); ctx.lineTo(x + bw - inset, y + bh / 2); ctx.stroke();
                    } else {
                        ctx.beginPath(); ctx.moveTo(x + bw / 2, y + inset); ctx.lineTo(x + bw / 2, y + bh - inset); ctx.stroke();
                    }
                }
                ctx.restore();
            }

        }
    }

    _drawBuildingLabels(ctx) {
        const iconMap = {
            cafe: "☕",
            park: "🌳",
            shop: "🏪",
            house: "🏠",
            shrine: "⛩",
            school: "🏫",
            library: "📚",
            gym: "🏋️",
            arcade: "🕹️",
            hospital: "🏥",
        };

        const houseOwners = {};
        for (const npc of this.npcStates || []) {
            if (npc.home_location && !houseOwners[npc.home_location]) {
                if (npc.name) {
                    houseOwners[npc.home_location] = `${npc.name.split(" ")[0].trim()} House`;
                }
            }
        }

        for (const loc of this.world.locations || []) {
            const { bw, bh, type } = loc;
            const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);

            // Location Icon and name dynamically shown based on scale
            if (this._scale > 0.8 && iconMap[type]) {
                const targetFontSize = Math.max(8, Math.min(bw, bh) * 0.5);
                const fontSize = targetFontSize * Math.pow(scaleFactor, 0.5);
                ctx.font = `${fontSize}px serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(iconMap[type], loc.x, loc.y - (this._scale > 1.5 ? 4 * scaleFactor : 0));
            }

            if (this._scale > 1.5) {
                let displayName = loc.name || type;
                if (type === "house" && houseOwners[loc.id]) {
                    displayName = houseOwners[loc.id];
                }

                ctx.font = `${Math.max(4, 7 * scaleFactor)}px "Segoe UI", Arial, sans-serif`;
                ctx.fillStyle = "#333333";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(displayName, loc.x, loc.y + 2 * scaleFactor);
            }
        }
    }

    _getAvatar(hash) {
        if (!hash) return null;
        const cached = this._avatarCache[hash];
        if (cached) return cached.loaded ? cached.img : null;
        const img = new Image();
        const entry = { img, loaded: false };
        this._avatarCache[hash] = entry;
        img.onload = () => { entry.loaded = true; };
        img.onerror = () => { entry.loaded = false; entry.failed = true; };
        img.src = `/image/${hash}`;
        return null;
    }

    _drawNpcMarker(ctx, x, y, activity, npc, skipRing = false) {
        const hash = npc && npc.character_hash;
        const avatar = hash ? this._getAvatar(hash) : null;
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        const radius = 9 * scaleFactor;

        // Determine need progress
        const activityToNeed = {
            eat: "hunger",
            sleep: "rest",
            socialize: "social",
            relax: "rest",
            study: "social",
            work: "work",
        };
        let progress = 0.0;
        if (npc && npc.needs) {
            const needName = activityToNeed[activity];
            if (needName && typeof npc.needs[needName] === "number") {
                progress = Math.max(0, Math.min(1.0, 1.0 - npc.needs[needName]));
            }
        }

        if (avatar) {
            // Background ring (faint)
            if (progress > 0 && !skipRing) {
                ctx.beginPath();
                ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(100, 100, 100, 0.25)";
                ctx.fill();

                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.arc(x, y, radius + 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                ctx.closePath();
                ctx.fillStyle = this._npcActivityColor(activity);
                ctx.fill();
            }

            // Circular clipped avatar (center-crop to square)
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            const iw = avatar.naturalWidth;
            const ih = avatar.naturalHeight;
            const side = Math.min(iw, ih);
            const sx = (iw - side) / 2;
            const sy = (ih - side) * 0.3; // bias toward top for faces
            ctx.drawImage(avatar, sx, sy, side, side, x - radius, y - radius, radius * 2, radius * 2);
            ctx.restore();
        } else {
            // Fallback colored dot
            ctx.beginPath();
            ctx.arc(x, y, 6.5 * scaleFactor, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff";
            ctx.fill();

            if (progress > 0 && progress < 1.0 && !skipRing) {
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.arc(x, y, 4.5 * scaleFactor, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
                ctx.closePath();
                ctx.fillStyle = this._npcActivityColor(activity);
                ctx.fill();
            } else if (!skipRing) {
                ctx.beginPath();
                ctx.arc(x, y, 4.5 * scaleFactor, 0, Math.PI * 2);
                ctx.fillStyle = this._npcActivityColor(activity);
                ctx.fill();
            }
        }

        // Draw target location icon if moving
        const movement = (npc && npc.movement) || {};
        const t = performance.now() / 1000;
        const breathOffset = npc ? npc.id : 0;
        // Float translation avoids intense GPU lag caused by vector text scale matrix changes 
        const floatY = Math.sin(t * 4.0 + breathOffset) * 1.5;

        const iconScale = 1 / Math.pow(this._scale || 1, 0.95);

        if (movement.active && (movement.mode === "walk" || movement.mode === "run")) {
            const targetId = movement.target_location;
            const locList = this.world.locations || [];
            const targetLoc = locList.find(loc => loc.id === targetId);
            if (targetLoc) {
                const iconMap = {
                    cafe: "☕",
                    park: "🌳",
                    shop: "🏪",
                    house: "🏠",
                    shrine: "⛩",
                    school: "🏫",
                };
                const iconStr = iconMap[targetLoc.type] || "📍";
                ctx.save();
                ctx.translate(x + radius * 0.8, y - radius * 0.8 + floatY);

                // Draw a simple white backdrop to replace expensive text shadow blur
                ctx.beginPath();
                ctx.arc(0, 0, 7 * iconScale, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                ctx.fill();

                ctx.font = `${Math.max(3, 11 * iconScale)}px serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#222";
                ctx.fillText(iconStr, 0, 0);
                ctx.restore();
            }
        } else if (npc && npc.activity && npc.activity !== "walk" && npc.activity !== "run" && npc.activity !== "idle" && npc.activity !== "wander") {
            const activityIconMap = {
                eat: "🍽️",
                sleep: "💤",
                socialize: "💬",
                relax: "☕",
                study: "📖",
                work: "💼"
            };
            let iconStr = activityIconMap[npc.activity];
            if (npc.social_pair && npc.social_pair.icon) {
                iconStr = npc.social_pair.icon;
            }
            if (iconStr) {
                ctx.save();
                // Avoid overlapping target icon if both existed but here it's an else-if so it's fine.
                ctx.translate(x + radius * 0.8, y - radius * 0.8 + floatY);

                ctx.beginPath();
                ctx.arc(0, 0, 8 * iconScale, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                ctx.fill();

                ctx.font = `${Math.max(3, 12 * iconScale)}px serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(iconStr, 0, 0);
                ctx.restore();
            }
        }
    }

    _pointDistance(left, right) {
        return Math.hypot((left.x || 0) - (right.x || 0), (left.y || 0) - (right.y || 0));
    }

    _pointAlongPolyline(points, progressPx) {
        if (!Array.isArray(points) || !points.length) return null;
        if (points.length === 1) return { x: points[0].x, y: points[0].y };

        let remaining = Math.max(0, Number(progressPx) || 0);
        for (let i = 0; i < points.length - 1; i++) {
            const left = points[i];
            const right = points[i + 1];
            const segLen = this._pointDistance(left, right);
            if (segLen <= 1e-6) continue;
            if (remaining <= segLen) {
                const t = remaining / segLen;
                return {
                    x: left.x + (right.x - left.x) * t,
                    y: left.y + (right.y - left.y) * t,
                };
            }
            remaining -= segLen;
        }

        const last = points[points.length - 1];
        return { x: last.x, y: last.y };
    }

    _npcVisualState(npc) {
        if (npc.social_pair) return "socialize";
        const movement = npc.movement || {};
        if (movement.active && (movement.mode === "walk" || movement.mode === "run")) {
            return movement.mode;
        }
        return npc.activity;
    }

    _movingNpcPosition(npc) {
        const movement = npc.movement || {};
        if (!movement.active || !Array.isArray(movement.route_points) || movement.route_points.length < 2) {
            delete this._npcInterp[npc.id];
            return null;
        }
        if (this._simulationSpeed >= 5) return null;

        const npcId = npc.id;
        const serverProgress = Number(movement.progress_px) || 0;
        const speed = Number(movement.speed_px_per_sec) || 0;
        const totalDist = Number(movement.distance_px) || 0;
        const now = performance.now();

        let interp = this._npcInterp[npcId];
        if (!interp ||
            interp.targetLocation !== movement.target_location ||
            interp.originLocation !== movement.origin_location) {
            // New route — start fresh from server progress
            interp = {
                baseProgress: serverProgress,
                baseTime: now,
                targetLocation: movement.target_location,
                originLocation: movement.origin_location,
            };
            this._npcInterp[npcId] = interp;
        } else if (Math.abs(serverProgress - interp.lastServerProgress) > 0.01) {
            // Server progress changed — rebase from current extrapolated position
            const elapsed = Math.max(0, (now - interp.baseTime) / 1000);
            const extrapolated = Math.min(totalDist, interp.baseProgress + speed * elapsed);
            // Use the further of server or extrapolated to avoid jumping back
            interp.baseProgress = Math.max(serverProgress, extrapolated);
            interp.baseTime = now;
        }
        interp.lastServerProgress = serverProgress;

        const elapsedSec = Math.max(0, (now - interp.baseTime) / 1000);
        const progressPx = Math.min(totalDist, interp.baseProgress + speed * elapsedSec);
        return this._pointAlongPolyline(movement.route_points, progressPx);
    }

    _drawNpcs(ctx) {
        this._npcRenderPos = {};
        const locMap = Object.fromEntries((this.world.locations || []).map((loc) => [loc.id, loc]));
        const stationaryByLoc = {};
        const moving = [];
        const roadSocialPairs = [];
        const socialPairs = [];
        const handledSocialIds = new Set();

        for (const npc of this.npcStates) {
            const pos = this._movingNpcPosition(npc);
            if (pos) {
                moving.push({ npc, pos });
            } else if (npc.social_pair && !handledSocialIds.has(npc.id)) {
                // Find partner
                const partnerId = npc.social_pair.partner_id;
                const partner = this.npcStates.find(n => n.id === partnerId);
                if (partner) {
                    handledSocialIds.add(npc.id);
                    handledSocialIds.add(partner.id);
                    
                    if (npc.movement && npc.movement.render_position && !npc.movement.active && npc.movement.render_position.x !== undefined) {
                        roadSocialPairs.push({ a: npc, b: partner, pos: npc.movement.render_position });
                    } else {
                        socialPairs.push({ a: npc, b: partner, locId: npc.current_location });
                    }
                } else {
                    (stationaryByLoc[npc.current_location] = stationaryByLoc[npc.current_location] || []).push(npc);
                }
            } else if (!handledSocialIds.has(npc.id)) {
                (stationaryByLoc[npc.current_location] = stationaryByLoc[npc.current_location] || []).push(npc);
            }
        }

        for (const item of moving) {
            this._drawNpcMarker(ctx, item.pos.x, item.pos.y, this._npcVisualState(item.npc), item.npc);
            this._npcRenderPos[item.npc.id] = { x: item.pos.x, y: item.pos.y };
        }
        
        // Group stationary and social pairs by location to draw
        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        const radius = 9 * scaleFactor;
        
        // Draw road social pairs exactly where they met
        for (const pair of roadSocialPairs) {
            this._drawSocialPair(ctx, pair, pair.pos.x, pair.pos.y, radius);
        }

        const spacing = radius * 2.4;
        const ySpacing = radius * 2.8;
        
        // Convert socialPairs into pseudo-NPC items that take up 2 horizontal slots
        for (const pair of socialPairs) {
            const list = (stationaryByLoc[pair.locId] = stationaryByLoc[pair.locId] || []);
            list.push({ isPair: true, data: pair });
        }

        for (const [locId, items] of Object.entries(stationaryByLoc)) {
            const loc = locMap[locId];
            if (!loc) continue;

            const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
            const radius = 9 * scaleFactor;
            const spacing = radius * 2.4;
            const ySpacing = radius * 2.8;

            const maxPerRow = loc.type === "house" ? 3 : 6;
            
            const rows = [];
            let currentRow = [];
            let currentRowSlots = 0;
            
            const pairItems = items.filter(i => i.isPair);
            const singleItems = items.filter(i => !i.isPair);
            
            // Layout pairs
            for (const item of pairItems) {
                if (currentRowSlots + 2 > maxPerRow && currentRowSlots > 0) {
                    rows.push({ items: currentRow, slots: currentRowSlots });
                    currentRow = [];
                    currentRowSlots = 0;
                }
                currentRow.push({ item, slots: 2 });
                currentRowSlots += 2;
            }
            if (currentRow.length > 0) {
                rows.push({ items: currentRow, slots: currentRowSlots });
                currentRow = [];
                currentRowSlots = 0;
            }
            
            // Layout singles
            for (const item of singleItems) {
                if (currentRowSlots + 1 > maxPerRow && currentRowSlots > 0) {
                    rows.push({ items: currentRow, slots: currentRowSlots });
                    currentRow = [];
                    currentRowSlots = 0;
                }
                currentRow.push({ item, slots: 1 });
                currentRowSlots += 1;
            }
            if (currentRow.length > 0) {
                rows.push({ items: currentRow, slots: currentRowSlots });
            }
            
            const numRows = rows.length;
            const startY = loc.y - ((numRows - 1) * ySpacing) / 2;
            
            const drawQueue = []; // to draw back-to-front
            
            for (let r = 0; r < numRows; r++) {
                const rowObj = rows[r];
                const y = startY + r * ySpacing;
                
                const startXForRow = loc.x - ((rowObj.slots - 1) * spacing) / 2;
                let col = 0;
                
                for (let c = 0; c < rowObj.items.length; c++) {
                    const cell = rowObj.items[c];
                    const centerOffset = (cell.slots - 1) * spacing / 2;
                    const x = startXForRow + col * spacing + centerOffset;
                    
                    drawQueue.push({ item: cell.item, x, y, col, slots: cell.slots });
                    col += cell.slots;
                }
            }
            
            // Draw from right to left so left items overlap right items
            drawQueue.sort((a, b) => b.col - a.col);
            
            for (const q of drawQueue) {
                if (q.item.isPair) {
                    this._drawSocialPair(ctx, q.item.data, q.x, q.y, radius);
                } else {
                    const npc = q.item;
                    this._drawNpcMarker(ctx, q.x, q.y, this._npcVisualState(npc), npc);
                    this._npcRenderPos[npc.id] = { x: q.x, y: q.y };
                }
            }
        }
    }

    _drawSocialPair(ctx, pair, cx, cy, radius) {
        const offset = radius * 0.6;
        const x1 = cx - offset;
        const y1 = cy;
        const x2 = cx + offset;
        const y2 = cy;

        // Determine relationship color between the pair
        const partnerId = String(pair.b.id);
        const relScore = (pair.a.relationships && pair.a.relationships[partnerId]) || 0.35;
        const relColor = this._relationshipColor(relScore);
        
        ctx.save();
        const barH = radius * 2.2;
        const barW = (x2 - x1) + radius * 2.5;
        ctx.fillStyle = "rgba(100, 100, 100, 0.4)";
        this._roundRect(ctx, x1 - radius * 1.25, y1 - radius * 1.1, barW, barH, barH / 2);
        ctx.fill();
        
        const progress = pair.a.social_pair.progress || 0;
        if (progress > 0) {
            ctx.save();
            this._roundRect(ctx, x1 - radius * 1.25, y1 - radius * 1.1, barW, barH, barH / 2);
            ctx.clip();
            ctx.fillStyle = relColor;
            ctx.fillRect(x1 - radius * 1.25, y1 - radius * 1.1, barW * progress, barH);
            ctx.restore();
        }
        ctx.restore();
        
        this._drawNpcMarker(ctx, x2, y2, "socialize", pair.b, true);
        this._drawNpcMarker(ctx, x1, y1, "socialize", pair.a, true);
        
        this._npcRenderPos[pair.a.id] = { x: x1, y: y1 };
        this._npcRenderPos[pair.b.id] = { x: x2, y: y2 };
    }

    _relationshipColor(score) {
        if (score <= 0.1)  return "#ff4444";  // Kẻ thù — đỏ
        if (score <= 0.25) return "#ff8844";  // Ghét — cam
        if (score <= 0.45) return "#aaaaaa";  // Người lạ — xám
        if (score <= 0.65) return "#88cc44";  // Bạn — xanh lá
        if (score <= 0.85) return "#44cc88";  // Bạn thân — ngọc lam
        return "#ff88ff";                     // Người yêu — hồng
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    _drawLabels(ctx) {
        if (this._scale > 1.2) return; // Hide district labels when zooming in

        for (const district of this.world.districts || []) {
            const scaleFactor = 1 / Math.pow(this._scale || 1, 0.4);
            const fontSize = Math.max(9, Math.min(13, district.radius * 0.09)) * scaleFactor;
            ctx.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
            ctx.fillStyle = this._districtLabelColor(district.type);
            ctx.globalAlpha = 0.65;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(district.type.toUpperCase(), district.x, district.y);
            ctx.globalAlpha = 1;
        }
    }

    _drawTimeOfDayAndGlows(ctx) {
        if (this._worldTimeSeconds === undefined) return;

        const currentHour = (this._worldTimeSeconds % 86400) / 3600;
        
        const stops = [
            { h: 0,  r: 10, g: 15, b: 50, a: 0.5, l: 1.0 },
            { h: 5.5, r: 10, g: 15, b: 50, a: 0.5, l: 1.0 },
            { h: 6,  r: 255, g: 255, b: 255, a: 0.0, l: 0.0 },
            { h: 14, r: 255, g: 255, b: 255, a: 0.0, l: 0.0 },
            { h: 16, r: 255, g: 120, b: 0,  a: 0.2, l: 0.0 },
            { h: 18.5, r: 200, g: 80, b: 20, a: 0.3, l: 0.5 },
            { h: 19, r: 10,  g: 15, b: 50, a: 0.5, l: 1.0 },
            { h: 24, r: 10,  g: 15, b: 50, a: 0.5, l: 1.0 }
        ];

        let s1 = stops[0], s2 = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
            if (currentHour >= stops[i].h && currentHour <= stops[i+1].h) {
                s1 = stops[i];
                s2 = stops[i+1];
                break;
            }
        }

        const t = (s2.h === s1.h) ? 0 : (currentHour - s1.h) / (s2.h - s1.h);
        const r = Math.round(s1.r + (s2.r - s1.r) * t);
        const g = Math.round(s1.g + (s2.g - s1.g) * t);
        const b = Math.round(s1.b + (s2.b - s1.b) * t);
        const a = s1.a + (s2.a - s1.a) * t;
        const l = s1.l + (s2.l - s1.l) * t;

        if (a > 0) {
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            const pad = 2000;
            const w = this._bounds ? this._bounds.w : 2000;
            const h = this._bounds ? this._bounds.h : 2000;
            const mx = this._bounds ? this._bounds.minX : -500;
            const my = this._bounds ? this._bounds.minY : -500;
            ctx.fillRect(mx - pad, my - pad, w + pad * 2, h + pad * 2);
        }

        if (l > 0.01) {
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            
            const drawGlow = (cx, cy, radius, strength) => {
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
                grad.addColorStop(0, `rgba(255, 230, 150, ${strength * 0.35})`);
                grad.addColorStop(0.3, `rgba(255, 200, 100, ${strength * 0.15})`);
                grad.addColorStop(1, `rgba(255, 150, 50, 0)`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                ctx.fill();
            };

            for (const loc of this.world.locations || []) {
                if (loc.type === "park" || loc.type === "nature" || loc.type === "shrine") continue;
                const size = Math.max(loc.bw, loc.bh);
                const radius = size * 0.6 + 5;
                const cx = loc.bx + loc.bw / 2;
                const cy = loc.by + loc.bh / 2;
                drawGlow(cx, cy, radius, l);
            }

            for (const int of this._intersections || []) {
                drawGlow(int.x, int.y, 18, l * 0.6);
            }

            ctx.restore();
        }
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    render(npcStates, meta = {}) {
        if (npcStates !== undefined) this.npcStates = npcStates;
        if (meta.simulationSpeed !== undefined) {
            this._simulationSpeed = Number(meta.simulationSpeed) || 1;
        }
        if (meta.worldTimeSeconds !== undefined) {
            this._worldTimeSeconds = Number(meta.worldTimeSeconds) || 0;
        }
        this._lastSnapshotAtMs = performance.now();
        // Clean up interpolation state for NPCs that are no longer moving
        const activeIds = new Set();
        for (const npc of this.npcStates) {
            if (npc.movement && npc.movement.active) activeIds.add(npc.id);
        }
        for (const id of Object.keys(this._npcInterp)) {
            if (!activeIds.has(Number(id))) delete this._npcInterp[id];
        }
        this._draw();
    }

    setWorld(world) {
        if (world === this.world) return;
        this.world = world;
        this._fitToCanvas();
        this._generateTerrain();
        this._generateDecorations();
        this._draw();
    }

    resize(cssW, cssH) {
        this.canvas.style.width = `${cssW}px`;
        this.canvas.style.height = `${cssH}px`;
        this._applyDpr();
        this._fitToCanvas();
        this._draw();
    }

    destroy() {
        if (this._animationHandle !== null) {
            cancelAnimationFrame(this._animationHandle);
            this._animationHandle = null;
        }
        this._removeEvents();
        this._avatarCache = {};
        this._npcInterp = {};
    }

    onNpcClick(cb) {
        this._onNpcClick = cb;
    }

    onLocationClick(cb) {
        this._onLocationClick = cb;
    }

    setZoom(delta) {
        this._zoomAt(this._cssW / 2, this._cssH / 2, 1 + delta);
    }

    setPan(dx, dy) {
        this._tx += dx;
        this._ty += dy;
        this._draw();
    }

    _startAnimationLoop() {
        const frame = () => {
            this._draw();
            this._animationHandle = requestAnimationFrame(frame);
        };
        this._animationHandle = requestAnimationFrame(frame);
    }

    _registerEvents() {
        const canvas = this.canvas;
        this._boundHandlers = {
            wheel: (e) => this._onWheel(e),
            mousedown: (e) => this._onMouseDown(e),
            mousemove: (e) => this._onMouseMove(e),
            mouseup: () => this._onMouseUp(),
            mouseleave: () => this._onMouseUp(),
            click: (e) => this._onClick(e),
            touchstart: (e) => this._onTouchStart(e),
            touchmove: (e) => this._onTouchMove(e),
            touchend: (e) => this._onTouchEnd(e),
        };
        canvas.addEventListener("wheel", this._boundHandlers.wheel, { passive: false });
        canvas.addEventListener("mousedown", this._boundHandlers.mousedown);
        canvas.addEventListener("mousemove", this._boundHandlers.mousemove);
        canvas.addEventListener("mouseup", this._boundHandlers.mouseup);
        canvas.addEventListener("mouseleave", this._boundHandlers.mouseleave);
        canvas.addEventListener("click", this._boundHandlers.click);
        canvas.addEventListener("touchstart", this._boundHandlers.touchstart, { passive: false });
        canvas.addEventListener("touchmove", this._boundHandlers.touchmove, { passive: false });
        canvas.addEventListener("touchend", this._boundHandlers.touchend);

        this._isPanning = false;
        this._panStartX = 0;
        this._panStartY = 0;
        this._didPan = false;
        this._lastPinchDist = null;
    }

    _removeEvents() {
        if (!this._boundHandlers) return;
        const canvas = this.canvas;
        canvas.removeEventListener("wheel", this._boundHandlers.wheel);
        canvas.removeEventListener("mousedown", this._boundHandlers.mousedown);
        canvas.removeEventListener("mousemove", this._boundHandlers.mousemove);
        canvas.removeEventListener("mouseup", this._boundHandlers.mouseup);
        canvas.removeEventListener("mouseleave", this._boundHandlers.mouseleave);
        canvas.removeEventListener("click", this._boundHandlers.click);
        canvas.removeEventListener("touchstart", this._boundHandlers.touchstart);
        canvas.removeEventListener("touchmove", this._boundHandlers.touchmove);
        canvas.removeEventListener("touchend", this._boundHandlers.touchend);
        this._boundHandlers = null;
    }

    _zoomAt(cx, cy, factor) {
        const newScale = Math.min(8, Math.max(0.15, this._scale * factor));
        this._tx = cx - (cx - this._tx) * (newScale / this._scale);
        this._ty = cy - (cy - this._ty) * (newScale / this._scale);
        this._scale = newScale;
        this._draw();
    }

    _onWheel(event) {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        this._zoomAt(
            event.clientX - rect.left,
            event.clientY - rect.top,
            event.deltaY < 0 ? 1.12 : 0.89,
        );
    }

    _onMouseDown(event) {
        this._isPanning = true;
        this._didPan = false;
        this._panStartX = event.clientX;
        this._panStartY = event.clientY;
        this.canvas.style.cursor = "grabbing";
    }

    _onMouseMove(event) {
        if (!this._isPanning) return;
        const dx = event.clientX - this._panStartX;
        const dy = event.clientY - this._panStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._didPan = true;
        this._panStartX = event.clientX;
        this._panStartY = event.clientY;
        this.setPan(dx, dy);
    }

    _onMouseUp() {
        this._isPanning = false;
        this.canvas.style.cursor = "default";
    }

    _canvasToWorld(cx, cy) {
        return {
            x: (cx - this._tx) / this._scale,
            y: (cy - this._ty) / this._scale,
        };
    }

    _onClick(event) {
        if (this._didPan) {
            this._didPan = false;
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        const { x, y } = this._canvasToWorld(event.clientX - rect.left, event.clientY - rect.top);

        const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
        for (const [npcId, pos] of Object.entries(this._npcRenderPos)) {
            if (Math.hypot(x - pos.x, y - pos.y) <= 10 * scaleFactor) {
                this._onNpcClick?.(parseInt(npcId, 10));
                return;
            }
        }

        for (const loc of this.world.locations || []) {
            if (x >= loc.bx && x <= loc.bx + loc.bw && y >= loc.by && y <= loc.by + loc.bh) {
                this._onLocationClick?.(loc.id);
                return;
            }
        }
    }

    _onTouchStart(event) {
        if (event.touches.length === 2) {
            this._lastPinchDist = this._getTouchDist(event.touches);
        } else if (event.touches.length === 1) {
            this._isPanning = true;
            this._didPan = false;
            this._panStartX = event.touches[0].clientX;
            this._panStartY = event.touches[0].clientY;
        }
    }

    _onTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 2) {
            const dist = this._getTouchDist(event.touches);
            if (this._lastPinchDist !== null) {
                const rect = this.canvas.getBoundingClientRect();
                const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
                const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
                this._zoomAt(cx, cy, dist / this._lastPinchDist);
            }
            this._lastPinchDist = dist;
        } else if (event.touches.length === 1 && this._isPanning) {
            const dx = event.touches[0].clientX - this._panStartX;
            const dy = event.touches[0].clientY - this._panStartY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this._didPan = true;
            this._panStartX = event.touches[0].clientX;
            this._panStartY = event.touches[0].clientY;
            this.setPan(dx, dy);
        }
    }

    _onTouchEnd(event) {
        if (event.touches.length < 2) this._lastPinchDist = null;
        if (event.touches.length === 0) {
            // Single-finger tap: fire click if no panning occurred
            if (!this._didPan && event.changedTouches && event.changedTouches.length === 1) {
                const touch = event.changedTouches[0];
                const rect = this.canvas.getBoundingClientRect();
                const { x, y } = this._canvasToWorld(
                    touch.clientX - rect.left,
                    touch.clientY - rect.top,
                );
                const scaleFactor = 1 / Math.pow(this._scale || 1, 0.6);
                for (const [npcId, pos] of Object.entries(this._npcRenderPos)) {
                    if (Math.hypot(x - pos.x, y - pos.y) <= 10 * scaleFactor) {
                        this._onNpcClick?.(parseInt(npcId, 10));
                        this._isPanning = false;
                        return;
                    }
                }
                for (const loc of this.world.locations || []) {
                    if (x >= loc.bx && x <= loc.bx + loc.bw && y >= loc.by && y <= loc.by + loc.bh) {
                        this._onLocationClick?.(loc.id);
                        this._isPanning = false;
                        return;
                    }
                }
            }
            this._isPanning = false;
        }
    }

    _getTouchDist(touches) {
        return Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY,
        );
    }
}
