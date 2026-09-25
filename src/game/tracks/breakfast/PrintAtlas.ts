import * as THREE from "three";

const SIZE = 2048;
const DISPLAY_FONT = "Bungee, 'Arial Black', Impact, system-ui, sans-serif";

interface PixelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface UvRect {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
}

const REGIONS = {
    cerealFront: { x: 0, y: 0, w: 800, h: 1200 },
    cerealSide: { x: 820, y: 0, w: 280, h: 1200 },
    cerealTop: { x: 1120, y: 0, w: 380, h: 133 },
    cartonSide: { x: 1120, y: 160, w: 375, h: 1000 },
    gingham: { x: 1520, y: 0, w: 512, h: 512 },
    paper: { x: 1540, y: 540, w: 48, h: 48 },
    cardboard: { x: 1620, y: 540, w: 48, h: 48 },
    newspaper: { x: 0, y: 1220, w: 1000, h: 750 },
} satisfies Record<string, PixelRect>;

export type AtlasRegion = keyof typeof REGIONS;

/** Every printed surface on the table — boxes, cartons, newspaper, gingham — in one texture and one draw call. */
export class PrintAtlas {
    readonly texture: THREE.CanvasTexture;

    constructor() {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d")!;

        ctx.fillStyle = "#f4efe3";
        ctx.fillRect(0, 0, SIZE, SIZE);

        drawCerealFront(ctx, REGIONS.cerealFront);
        drawCerealSide(ctx, REGIONS.cerealSide);
        drawCerealTop(ctx, REGIONS.cerealTop);
        drawCartonSide(ctx, REGIONS.cartonSide);
        drawGingham(ctx, REGIONS.gingham);
        fill(ctx, REGIONS.paper, "#f6f3ea");
        fill(ctx, REGIONS.cardboard, "#c9a878");
        drawNewspaper(ctx, REGIONS.newspaper);

        this.texture = new THREE.CanvasTexture(canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.texture.generateMipmaps = true;
        this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    }

    /** UV rectangle of a region, inset half a texel so mipmaps do not bleed between regions. */
    public rect(region: AtlasRegion): UvRect {
        const r = REGIONS[region];
        const inset = 2;
        return {
            u0: (r.x + inset) / SIZE,
            u1: (r.x + r.w - inset) / SIZE,
            v0: 1 - (r.y + r.h - inset) / SIZE,
            v1: 1 - (r.y + inset) / SIZE,
        };
    }

    public dispose(): void {
        this.texture.dispose();
    }
}

/** Squeezes a geometry's 0..1 UVs into an atlas rectangle. */
export function remapUv(geometry: THREE.BufferGeometry, rect: UvRect, start = 0, count?: number): void {
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    const end = count === undefined ? uv.count : start + count;
    for (let i = start; i < end; i++) {
        uv.setXY(i, rect.u0 + uv.getX(i) * (rect.u1 - rect.u0), rect.v0 + uv.getY(i) * (rect.v1 - rect.v0));
    }
    uv.needsUpdate = true;
}

/** BoxGeometry faces in order +x, −x, +y, −y, +z, −z, each mapped to its own region. */
export function remapBoxFaces(geometry: THREE.BoxGeometry, faces: readonly UvRect[]): void {
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    const perFace = uv.count / 6;
    faces.forEach((rect, face) => remapUv(geometry, rect, face * perFace, perFace));
}

function fill(ctx: CanvasRenderingContext2D, r: PixelRect, color: string): void {
    ctx.fillStyle = color;
    ctx.fillRect(r.x, r.y, r.w, r.h);
}

function outlinedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
    fillColor: string,
    strokeColor: string,
    strokeWidth: number,
): void {
    ctx.font = `${size}px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
}

function hoop(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2, true);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = radius * 0.12;
    ctx.strokeStyle = "rgba(90,40,10,0.55)";
    ctx.stroke();
}

function starburst(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, points: number): void {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

function drawCerealFront(ctx: CanvasRenderingContext2D, r: PixelRect): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.translate(r.x, r.y);

    const background = ctx.createLinearGradient(0, 0, 0, r.h);
    background.addColorStop(0, "#1d6fd6");
    background.addColorStop(1, "#0f3f9a");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, r.w, r.h);

    // Sunburst rays behind the bowl.
    ctx.save();
    ctx.translate(r.w / 2, 780);
    for (let i = 0; i < 18; i++) {
        ctx.rotate((Math.PI * 2) / 18);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-60, -900);
        ctx.lineTo(60, -900);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = "#ffd23a";
    ctx.fillRect(0, 0, r.w, 70);
    ctx.fillStyle = "#e8322a";
    ctx.fillRect(0, 70, r.w, 14);

    ctx.save();
    ctx.translate(r.w / 2, 270);
    ctx.rotate(-0.07);
    outlinedText(ctx, "MICRO", 0, -70, 168, "#ffd23a", "#10245a", 26);
    outlinedText(ctx, "FLAKES", 0, 95, 150, "#ffffff", "#e8322a", 26);
    ctx.restore();

    // Bowl heaped with hoops.
    const bowlY = 830;
    ctx.fillStyle = "#f6f2e8";
    ctx.beginPath();
    ctx.ellipse(r.w / 2, bowlY - 40, 300, 60, 0, 0, Math.PI * 2);
    ctx.fill();
    const colors = ["#e8a93c", "#f0b84e", "#d48f2a", "#f5c35c"];
    let seed = 7;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let i = 0; i < 46; i++) {
        const angle = random() * Math.PI;
        const spread = random();
        const hx = r.w / 2 + Math.cos(angle) * 270 * spread;
        const hy = bowlY - 60 - Math.sin(angle) * 150 * spread * (0.6 + random() * 0.6);
        hoop(ctx, hx, hy, 30 + random() * 12, colors[i % colors.length]);
    }
    ctx.fillStyle = "#e8322a";
    ctx.beginPath();
    ctx.ellipse(r.w / 2, bowlY - 30, 330, 50, 0, 0, Math.PI);
    ctx.lineTo(r.w / 2 - 250, bowlY + 170);
    ctx.quadraticCurveTo(r.w / 2, bowlY + 230, r.w / 2 + 250, bowlY + 170);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(r.w / 2 - 280, bowlY + 20, 560, 18);

    // A tiny racer leaping over the bowl — the box knows exactly who is eating breakfast.
    ctx.save();
    ctx.translate(250, 560);
    ctx.rotate(-0.25);
    ctx.fillStyle = "#ffd23a";
    ctx.beginPath();
    ctx.roundRect(-90, -30, 180, 50, 18);
    ctx.fill();
    ctx.fillStyle = "#1b1c20";
    ctx.beginPath();
    ctx.roundRect(-40, -62, 80, 40, 14);
    ctx.fill();
    for (const wheelX of [-55, 55]) {
        ctx.beginPath();
        ctx.arc(wheelX, 24, 24, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 8;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-120 - i * 10, -20 + i * 22);
        ctx.lineTo(-190 - i * 25, -20 + i * 22);
        ctx.stroke();
    }
    ctx.restore();

    starburst(ctx, 640, 520, 110, 78, 14);
    ctx.fillStyle = "#ffd23a";
    ctx.fill();
    ctx.save();
    ctx.translate(640, 520);
    ctx.rotate(0.2);
    outlinedText(ctx, "NEW!", 0, -18, 52, "#e8322a", "#ffffff", 8);
    outlinedText(ctx, "TURBO", 0, 32, 34, "#10245a", "#ffd23a", 2);
    ctx.restore();

    ctx.fillStyle = "#ffd23a";
    ctx.beginPath();
    ctx.moveTo(40, 1060);
    ctx.lineTo(r.w - 40, 1060);
    ctx.lineTo(r.w - 70, 1130);
    ctx.lineTo(70, 1130);
    ctx.closePath();
    ctx.fill();
    ctx.font = `44px ${DISPLAY_FONT}`;
    ctx.fillStyle = "#10245a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("CRUNCHY HONEY HOOPS", r.w / 2, 1097);

    ctx.restore();
}

function drawCerealSide(ctx: CanvasRenderingContext2D, r: PixelRect): void {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = "#1d6fd6";
    ctx.fillRect(0, 0, r.w, r.h);
    ctx.fillStyle = "#ffd23a";
    ctx.fillRect(0, 0, r.w, 70);

    ctx.fillStyle = "#fbf8ef";
    ctx.beginPath();
    ctx.roundRect(24, 120, r.w - 48, 620, 18);
    ctx.fill();
    ctx.fillStyle = "#1b1c20";
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Nutrition", 44, 170);
    ctx.fillRect(44, 190, r.w - 88, 8);
    for (let i = 0; i < 14; i++) {
        const y = 230 + i * 34;
        ctx.fillStyle = "#555";
        ctx.fillRect(44, y, 60 + ((i * 37) % 90), 10);
        ctx.fillRect(r.w - 110, y, 50, 10);
        ctx.fillStyle = "#ccc";
        ctx.fillRect(44, y + 20, r.w - 88, 2);
    }

    ctx.save();
    ctx.translate(r.w / 2, 960);
    ctx.rotate(-Math.PI / 2);
    outlinedText(ctx, "MICRO FLAKES", 0, 0, 64, "#ffd23a", "#10245a", 12);
    ctx.restore();
    ctx.restore();
}

function drawCerealTop(ctx: CanvasRenderingContext2D, r: PixelRect): void {
    fill(ctx, r, "#ffd23a");
    ctx.fillStyle = "#e8322a";
    ctx.fillRect(r.x, r.y + r.h / 2 - 6, r.w, 12);
}

function drawCartonSide(ctx: CanvasRenderingContext2D, r: PixelRect): void {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = "#fffaf0";
    ctx.fillRect(0, 0, r.w, r.h);

    const band = ctx.createLinearGradient(0, 0, 0, 260);
    band.addColorStop(0, "#ff9a1a");
    band.addColorStop(1, "#ff7a00");
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, r.w, 260);
    outlinedText(ctx, "SUNNY", r.w / 2, 130, 92, "#ffffff", "#c24a00", 14);

    ctx.fillStyle = "#ff8c1a";
    ctx.beginPath();
    ctx.arc(r.w / 2, 520, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffb04d";
    ctx.beginPath();
    ctx.arc(r.w / 2 - 34, 486, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3f9b3a";
    ctx.beginPath();
    ctx.ellipse(r.w / 2 + 40, 392, 52, 22, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#c24a00";
    ctx.font = `50px ${DISPLAY_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ORANGE", r.w / 2, 730);
    ctx.fillText("JUICE", r.w / 2, 790);
    ctx.fillStyle = "#3f9b3a";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText("100% SQUEEZED", r.w / 2, 870);
    ctx.restore();
}

function drawGingham(ctx: CanvasRenderingContext2D, r: PixelRect): void {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = "#fbf7f0";
    ctx.fillRect(0, 0, r.w, r.h);
    const checks = 8;
    const step = r.w / checks;
    ctx.fillStyle = "rgba(206,32,40,0.55)";
    for (let i = 0; i < checks; i += 2) {
        ctx.fillRect(i * step, 0, step, r.h);
        ctx.fillRect(0, i * step, r.w, step);
    }
    ctx.restore();
}

function drawNewspaper(ctx: CanvasRenderingContext2D, r: PixelRect): void {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = "#eeebe1";
    ctx.fillRect(0, 0, r.w, r.h);

    ctx.fillStyle = "#1b1b1b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 78px Georgia, 'Times New Roman', serif";
    ctx.fillText("The Daily Crunch", r.w / 2, 70);
    ctx.fillRect(30, 120, r.w - 60, 5);
    ctx.fillRect(30, 132, r.w - 60, 2);

    ctx.font = "bold 52px Georgia, 'Times New Roman', serif";
    ctx.fillText("TINY CARS SEIZE KITCHEN TABLE", r.w / 2, 190);

    const photo = ctx.createLinearGradient(0, 240, 0, 520);
    photo.addColorStop(0, "#9a9a9a");
    photo.addColorStop(1, "#555");
    ctx.fillStyle = photo;
    ctx.fillRect(40, 240, 440, 290);
    ctx.fillStyle = "#2c2c2c";
    ctx.beginPath();
    ctx.roundRect(150, 400, 220, 60, 20);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(190, 468, 26, 0, Math.PI * 2);
    ctx.arc(330, 468, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#6d6d6d";
    const column = (x: number, top: number, width: number, lines: number) => {
        for (let i = 0; i < lines; i++) {
            const w = i % 7 === 6 ? width * 0.55 : width;
            ctx.fillRect(x, top + i * 22, w, 9);
        }
    };
    column(40, 560, 440, 8);
    column(520, 240, 200, 21);
    column(750, 240, 210, 21);
    ctx.fillStyle = "#1b1b1b";
    ctx.font = "bold 30px Georgia, serif";
    ctx.textAlign = "left";
    ctx.fillText("Toast shortage feared", 520, 740 - 20);
    ctx.restore();
}
