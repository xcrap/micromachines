import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { QUALITY_TIERS, type QualityTier } from "../game/core/Config";
import { CarModel } from "../game/car/CarModel";
import { MapBuilder, type GridSlot } from "../game/map/MapBuilder";
import { SceneLighting } from "../game/render/SceneLighting";
import { TRACKS, type TrackId } from "../game/tracks";

/**
 * Dev-only track viewer: /preview.html?track=breakfast&view=chase&t=0.25
 * Views: chase (gameplay camera at lap position t), top (whole map), orbit (free).
 * Keys: 1 chase, 2 top, 3 orbit, [ / ] step along the lap.
 */
const params = new URLSearchParams(window.location.search);
const trackId = (params.get("track") ?? "breakfast") as TrackId;
const theme = TRACKS[trackId] ?? TRACKS.breakfast;
const quality: QualityTier = QUALITY_TIERS[(params.get("quality") as QualityTier["name"]) ?? "high"] ?? QUALITY_TIERS.high;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.3, 2000);
const lighting = new SceneLighting(scene, renderer, quality);
lighting.apply(theme.environment, renderer);

const buildStart = performance.now();
const map = new MapBuilder(scene, quality, theme);
map.buildMap();
const buildMs = performance.now() - buildStart;

const slot: GridSlot = { x: 0, z: 0, heading: 0 };
const cars: THREE.Group[] = [];
for (let i = 0; i < 4; i++) {
    map.getGridSlot(i, slot);
    const root = new THREE.Group();
    root.position.set(slot.x, map.getSurfaceHeightAt(slot.x, slot.z), slot.z);
    root.rotation.y = slot.heading;
    new CarModel(root);
    scene.add(root);
    cars.push(root);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = false;

let view = params.get("view") ?? "chase";
let lapT = Number.parseFloat(params.get("t") ?? "0") || 0;
const focus = new THREE.Vector3();

function setView(nextView: string, t = lapT): void {
    view = nextView;
    lapT = ((t % 1) + 1) % 1;
    controls.enabled = view === "orbit";

    const path = map.getTrackPath();
    const sample = path.sampleAt(lapT);
    const y = map.getSurfaceHeightAt(sample.x, sample.z);
    focus.set(sample.x, y, sample.z);

    if (view === "top") {
        camera.position.set(0, 300, 1);
        camera.lookAt(0, 0, 0);
        focus.set(0, 0, 0);
    } else if (view === "chase") {
        camera.position.set(sample.x - sample.tangentX * 20, y + 22, sample.z - sample.tangentZ * 20);
        camera.lookAt(sample.x + sample.tangentX * 10, y + 1, sample.z + sample.tangentZ * 10);
    } else {
        camera.position.set(sample.x - sample.tangentX * 40 + 20, y + 35, sample.z - sample.tangentZ * 40);
        controls.target.copy(focus);
        controls.update();
    }
}

window.addEventListener("keydown", (event) => {
    if (event.key === "1") setView("chase");
    if (event.key === "2") setView("top");
    if (event.key === "3") setView("orbit");
    if (event.key === "]") setView(view, lapT + 0.02);
    if (event.key === "[") setView(view, lapT - 0.02);
});

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

(window as unknown as { __preview: unknown }).__preview = { setView, renderer, scene, camera, map };

setView(view, lapT);

const info = document.getElementById("info")!;
let last = performance.now();
let fps = 60;
let elapsed = 0;

function frame(now: number): void {
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    elapsed += delta;
    fps += (1 / Math.max(delta, 1e-3) - fps) * 0.05;

    if (controls.enabled) controls.update();
    map.update(elapsed, delta);
    lighting.follow(view === "top" ? focus : controls.enabled ? controls.target : focus);

    renderer.render(scene, camera);
    info.textContent =
        `${theme.name} [${view}] t=${lapT.toFixed(2)}  build ${buildMs.toFixed(0)}ms\n` +
        `fps ${fps.toFixed(0)}  calls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k`;
    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
