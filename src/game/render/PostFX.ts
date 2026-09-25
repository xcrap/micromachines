import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

const TILT_SHIFT_SHADER = {
    uniforms: {
        tDiffuse: { value: null as THREE.Texture | null },
        uStep: { value: new THREE.Vector2() },
        uFocus: { value: 0.42 },
        uBand: { value: 0.2 },
        uGrade: { value: 0 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uStep;
        uniform float uFocus;
        uniform float uBand;
        uniform float uGrade;
        varying vec2 vUv;

        void main() {
            // Sharp band through the middle of the frame, soft above and below — the miniature-photo look.
            // The far distance (top of frame) blurs harder than the foreground.
            float offset = vUv.y - uFocus;
            float amount = smoothstep(uBand, uBand + 0.32, abs(offset)) * (offset > 0.0 ? 1.0 : 0.55);
            vec2 stepUv = uStep * amount;

            vec4 color = texture2D(tDiffuse, vUv) * 0.2270270270;
            color += texture2D(tDiffuse, vUv + stepUv * 1.3846153846) * 0.3162162162;
            color += texture2D(tDiffuse, vUv - stepUv * 1.3846153846) * 0.3162162162;
            color += texture2D(tDiffuse, vUv + stepUv * 3.2307692308) * 0.0702702703;
            color += texture2D(tDiffuse, vUv - stepUv * 3.2307692308) * 0.0702702703;

            if (uGrade > 0.5) {
                // Toy-box colour: a touch more saturation and a soft vignette, applied before tone mapping.
                float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                color.rgb = mix(vec3(luma), color.rgb, 1.14);
                vec2 centered = (vUv - 0.5) * vec2(1.0, 0.85);
                color.rgb *= mix(1.0, 0.8, smoothstep(0.32, 0.78, length(centered)));
            }

            gl_FragColor = color;
        }
    `,
};

/** Maximum blur radius, in pixels at a 1080p-tall frame. */
const BLUR_PIXELS = 3.2;

/**
 * Multisampled scene render followed by a separable tilt-shift blur and the output transform
 * (tone mapping + sRGB). The composer owns the render targets so resolution scaling is one call.
 */
export class PostFX {
    private readonly composer: EffectComposer;
    private readonly renderPass: RenderPass;
    private readonly horizontal: ShaderPass;
    private readonly vertical: ShaderPass;
    private readonly output: OutputPass;
    private width = 1;
    private height = 1;

    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples: number) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
            type: THREE.HalfFloatType,
            samples,
        });

        this.composer = new EffectComposer(renderer, target);
        this.renderPass = new RenderPass(scene, camera);
        this.horizontal = new ShaderPass(TILT_SHIFT_SHADER);
        this.vertical = new ShaderPass(TILT_SHIFT_SHADER);
        this.vertical.uniforms.uGrade.value = 1;
        this.output = new OutputPass();

        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.horizontal);
        this.composer.addPass(this.vertical);
        this.composer.addPass(this.output);
    }

    public setSize(width: number, height: number, pixelRatio: number): void {
        this.width = width;
        this.height = height;
        this.composer.setPixelRatio(pixelRatio);
        this.composer.setSize(width, height);

        const pixelsX = width * pixelRatio;
        const pixelsY = height * pixelRatio;
        const blur = BLUR_PIXELS * (pixelsY / 1080);
        this.horizontal.uniforms.uStep.value.set(blur / pixelsX, 0);
        this.vertical.uniforms.uStep.value.set(0, blur / pixelsY);
    }

    public setPixelRatio(pixelRatio: number): void {
        this.setSize(this.width, this.height, pixelRatio);
    }

    /** Where the sharp band sits (0 = bottom of the frame, 1 = top). */
    public setFocus(focus: number, band: number): void {
        for (const pass of [this.horizontal, this.vertical]) {
            pass.uniforms.uFocus.value = focus;
            pass.uniforms.uBand.value = band;
        }
    }

    public render(deltaTime: number): void {
        this.composer.render(deltaTime);
    }

    public dispose(): void {
        this.horizontal.dispose();
        this.vertical.dispose();
        this.output.dispose();
        this.composer.dispose();
    }
}
