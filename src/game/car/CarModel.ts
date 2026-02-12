import * as THREE from 'three';

export class CarModel {
    private carBody: THREE.Group;
    private wheels: THREE.Mesh[] = [];
    private carGroup: THREE.Group;

    constructor(carGroup: THREE.Group) {
        this.carGroup = carGroup;
        this.carBody = new THREE.Group();
        this.carGroup.add(this.carBody);
        this.createCarModel();
    }

    private createCarModel(): void {
        this.createChassis();
        this.createCabin();
        this.createFenders();
        this.createHood();
        this.createRearDeck();
        this.createSpoiler();
        this.createLights();
        this.createExhaust();
        this.createBumpers();
        this.createRoofScoop();
        this.createSideStripes();
        this.createWheels();
    }

    private createChassis(): void {
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0xe63946,
            metalness: 0.7,
            roughness: 0.25,
        });

        const shape = new THREE.Shape();
        shape.moveTo(-0.42, 0);
        shape.lineTo(-0.44, 0.12);
        shape.lineTo(-0.40, 0.28);
        shape.quadraticCurveTo(-0.30, 0.35, 0, 0.36);
        shape.quadraticCurveTo(0.30, 0.35, 0.40, 0.28);
        shape.lineTo(0.44, 0.12);
        shape.lineTo(0.42, 0);
        shape.closePath();

        const extrudeSettings: THREE.ExtrudeGeometryOptions = {
            depth: 1.8,
            bevelEnabled: true,
            bevelThickness: 0.04,
            bevelSize: 0.04,
            bevelSegments: 4,
        };

        const bodyGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        bodyGeo.center();
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.22;
        body.rotation.y = Math.PI;
        body.castShadow = true;
        body.receiveShadow = true;
        this.carBody.add(body);

        const underGeo = new THREE.BoxGeometry(0.82, 0.06, 1.7);
        const underMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.9,
        });
        const under = new THREE.Mesh(underGeo, underMat);
        under.position.y = 0.15;
        under.castShadow = true;
        this.carBody.add(under);
    }

    private createCabin(): void {
        const glassMat = new THREE.MeshStandardMaterial({
            color: 0x1a2a3a,
            metalness: 0.95,
            roughness: 0.05,
            transparent: true,
            opacity: 0.75,
        });

        const cabinShape = new THREE.Shape();
        cabinShape.moveTo(-0.34, 0);
        cabinShape.lineTo(-0.32, 0.22);
        cabinShape.quadraticCurveTo(-0.20, 0.30, 0, 0.31);
        cabinShape.quadraticCurveTo(0.20, 0.30, 0.32, 0.22);
        cabinShape.lineTo(0.34, 0);
        cabinShape.closePath();

        const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
            depth: 0.7,
            bevelEnabled: true,
            bevelThickness: 0.02,
            bevelSize: 0.02,
            bevelSegments: 3,
        });
        cabinGeo.center();
        const cabin = new THREE.Mesh(cabinGeo, glassMat);
        cabin.position.set(0, 0.48, -0.05);
        cabin.rotation.y = Math.PI;
        cabin.castShadow = true;
        this.carBody.add(cabin);

        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            metalness: 0.5,
            roughness: 0.5,
        });

        const pillarGeo = new THREE.BoxGeometry(0.03, 0.24, 0.04);
        const pillarPositions = [
            { x: 0.33, z: 0.28 },
            { x: -0.33, z: 0.28 },
            { x: 0.33, z: -0.28 },
            { x: -0.33, z: -0.28 },
            { x: 0.34, z: 0.0 },
            { x: -0.34, z: 0.0 },
        ];
        for (const pos of pillarPositions) {
            const pillar = new THREE.Mesh(pillarGeo, pillarMat);
            pillar.position.set(pos.x, 0.55, pos.z - 0.05);
            pillar.castShadow = true;
            this.carBody.add(pillar);
        }
    }

    private createFenders(): void {
        const fenderMat = new THREE.MeshStandardMaterial({
            color: 0xcc2f3a,
            metalness: 0.6,
            roughness: 0.3,
        });

        const fenderGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16, 1, false, 0, Math.PI);

        const fenderConfigs = [
            { x: 0.42, z: 0.55, scaleX: 1 },
            { x: -0.42, z: 0.55, scaleX: -1 },
            { x: 0.42, z: -0.55, scaleX: 1 },
            { x: -0.42, z: -0.55, scaleX: -1 },
        ];

        for (const cfg of fenderConfigs) {
            const fender = new THREE.Mesh(fenderGeo, fenderMat);
            fender.position.set(cfg.x, 0.28, cfg.z);
            fender.rotation.z = cfg.scaleX > 0 ? -Math.PI / 2 : Math.PI / 2;
            fender.rotation.y = Math.PI / 2;
            fender.castShadow = true;
            fender.receiveShadow = true;
            this.carBody.add(fender);
        }
    }

    private createHood(): void {
        const hoodMat = new THREE.MeshStandardMaterial({
            color: 0xe63946,
            metalness: 0.7,
            roughness: 0.25,
        });

        const hoodGeo = new THREE.BoxGeometry(0.7, 0.04, 0.45);
        const hood = new THREE.Mesh(hoodGeo, hoodMat);
        hood.position.set(0, 0.44, 0.58);
        hood.rotation.x = -0.12;
        hood.castShadow = true;
        hood.receiveShadow = true;
        this.carBody.add(hood);

        const scoopMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            metalness: 0.8,
            roughness: 0.2,
        });
        const scoopGeo = new THREE.BoxGeometry(0.2, 0.05, 0.15);
        const scoop = new THREE.Mesh(scoopGeo, scoopMat);
        scoop.position.set(0, 0.47, 0.55);
        scoop.castShadow = true;
        this.carBody.add(scoop);
    }

    private createRearDeck(): void {
        const deckMat = new THREE.MeshStandardMaterial({
            color: 0xe63946,
            metalness: 0.7,
            roughness: 0.25,
        });

        const deckGeo = new THREE.BoxGeometry(0.7, 0.04, 0.35);
        const deck = new THREE.Mesh(deckGeo, deckMat);
        deck.position.set(0, 0.43, -0.60);
        deck.rotation.x = 0.08;
        deck.castShadow = true;
        deck.receiveShadow = true;
        this.carBody.add(deck);
    }

    private createSpoiler(): void {
        const spoilerMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            metalness: 0.6,
            roughness: 0.4,
        });

        const wingGeo = new THREE.BoxGeometry(0.8, 0.03, 0.12);
        const wing = new THREE.Mesh(wingGeo, spoilerMat);
        wing.position.set(0, 0.58, -0.82);
        wing.rotation.x = -0.15;
        wing.castShadow = true;
        this.carBody.add(wing);

        const strutGeo = new THREE.BoxGeometry(0.04, 0.12, 0.04);
        const leftStrut = new THREE.Mesh(strutGeo, spoilerMat);
        leftStrut.position.set(0.28, 0.50, -0.78);
        leftStrut.castShadow = true;
        this.carBody.add(leftStrut);

        const rightStrut = new THREE.Mesh(strutGeo, spoilerMat);
        rightStrut.position.set(-0.28, 0.50, -0.78);
        rightStrut.castShadow = true;
        this.carBody.add(rightStrut);
    }

    private createLights(): void {
        const headlightGeo = new THREE.CircleGeometry(0.07, 16);
        const headlightMat = new THREE.MeshStandardMaterial({
            color: 0xfff8e1,
            emissive: 0xfff8e1,
            emissiveIntensity: 1.0,
            side: THREE.FrontSide,
        });

        const headlightHousingGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16);
        const housingMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            metalness: 0.9,
            roughness: 0.1,
        });

        for (const xPos of [0.30, -0.30]) {
            const housing = new THREE.Mesh(headlightHousingGeo, housingMat);
            housing.position.set(xPos, 0.35, 0.92);
            housing.rotation.x = Math.PI / 2;
            this.carBody.add(housing);

            const light = new THREE.Mesh(headlightGeo, headlightMat);
            light.position.set(xPos, 0.35, 0.94);
            this.carBody.add(light);
        }

        const taillightGeo = new THREE.BoxGeometry(0.12, 0.06, 0.03);
        const taillightMat = new THREE.MeshStandardMaterial({
            color: 0xff1a1a,
            emissive: 0xff0000,
            emissiveIntensity: 0.8,
        });

        for (const xPos of [0.32, -0.32]) {
            const taillight = new THREE.Mesh(taillightGeo, taillightMat);
            taillight.position.set(xPos, 0.35, -0.92);
            this.carBody.add(taillight);
        }

        const turnSignalGeo = new THREE.BoxGeometry(0.06, 0.04, 0.03);
        const turnMat = new THREE.MeshStandardMaterial({
            color: 0xffab00,
            emissive: 0xff8f00,
            emissiveIntensity: 0.6,
        });

        for (const xPos of [0.42, -0.42]) {
            const frontTurn = new THREE.Mesh(turnSignalGeo, turnMat);
            frontTurn.position.set(xPos, 0.30, 0.88);
            this.carBody.add(frontTurn);
        }
    }

    private createExhaust(): void {
        const exhaustMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.9,
            roughness: 0.2,
        });

        const pipeGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.12, 12);

        for (const xPos of [0.22, -0.22]) {
            const pipe = new THREE.Mesh(pipeGeo, exhaustMat);
            pipe.position.set(xPos, 0.18, -0.95);
            pipe.rotation.x = Math.PI / 2;
            pipe.castShadow = true;
            this.carBody.add(pipe);
        }
    }

    private createBumpers(): void {
        const bumperMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            metalness: 0.4,
            roughness: 0.6,
        });

        const frontBumperGeo = new THREE.BoxGeometry(0.88, 0.1, 0.06);
        const frontBumper = new THREE.Mesh(frontBumperGeo, bumperMat);
        frontBumper.position.set(0, 0.22, 0.92);
        frontBumper.castShadow = true;
        this.carBody.add(frontBumper);

        const rearBumperGeo = new THREE.BoxGeometry(0.88, 0.1, 0.06);
        const rearBumper = new THREE.Mesh(rearBumperGeo, bumperMat);
        rearBumper.position.set(0, 0.22, -0.92);
        rearBumper.castShadow = true;
        this.carBody.add(rearBumper);

        const splitterGeo = new THREE.BoxGeometry(0.7, 0.02, 0.1);
        const splitter = new THREE.Mesh(splitterGeo, bumperMat);
        splitter.position.set(0, 0.15, 0.95);
        splitter.castShadow = true;
        this.carBody.add(splitter);
    }

    private createRoofScoop(): void {
        const scoopMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            metalness: 0.5,
            roughness: 0.5,
        });

        const scoopGeo = new THREE.BoxGeometry(0.14, 0.06, 0.1);
        const roofScoop = new THREE.Mesh(scoopGeo, scoopMat);
        roofScoop.position.set(0, 0.77, 0.15);
        roofScoop.castShadow = true;
        this.carBody.add(roofScoop);
    }

    private createSideStripes(): void {
        const stripeMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.3,
            roughness: 0.5,
        });

        const stripeGeo = new THREE.BoxGeometry(0.01, 0.04, 1.2);

        for (const xPos of [0.455, -0.455]) {
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.set(xPos, 0.32, 0);
            this.carBody.add(stripe);
        }

        const numberMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.2,
            roughness: 0.6,
        });
        const numberBgGeo = new THREE.CircleGeometry(0.1, 16);

        for (const xPos of [0.456, -0.456]) {
            const numberBg = new THREE.Mesh(numberBgGeo, numberMat);
            numberBg.position.set(xPos, 0.38, 0.0);
            numberBg.rotation.y = xPos > 0 ? Math.PI / 2 : -Math.PI / 2;
            this.carBody.add(numberBg);
        }
    }

    private createWheels(): void {
        const wheelRadius = 0.18;
        const wheelThickness = 0.1;

        const tireGeo = new THREE.TorusGeometry(wheelRadius, 0.06, 12, 24);
        const tireMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.95,
            metalness: 0.05,
        });

        const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.72, wheelRadius * 0.72, wheelThickness, 16);
        rimGeo.rotateZ(Math.PI / 2);
        const rimMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0,
            roughness: 0.15,
            metalness: 0.9,
        });

        const hubGeo = new THREE.CylinderGeometry(wheelRadius * 0.25, wheelRadius * 0.25, wheelThickness + 0.02, 8);
        hubGeo.rotateZ(Math.PI / 2);
        const hubMat = new THREE.MeshStandardMaterial({
            color: 0xff3333,
            roughness: 0.3,
            metalness: 0.7,
        });

        const spokeGeo = new THREE.BoxGeometry(wheelThickness - 0.02, wheelRadius * 0.5, 0.025);
        const spokeMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.2,
            metalness: 0.85,
        });

        const wheelPositions = [
            { x: 0.48, y: 0.18, z: 0.55 },
            { x: -0.48, y: 0.18, z: 0.55 },
            { x: 0.48, y: 0.18, z: -0.55 },
            { x: -0.48, y: 0.18, z: -0.55 },
        ];

        for (const pos of wheelPositions) {
            const wheelGroup = new THREE.Group();
            wheelGroup.position.set(pos.x, pos.y, pos.z);

            const tire = new THREE.Mesh(tireGeo, tireMat);
            tire.rotation.y = Math.PI / 2;
            tire.castShadow = true;
            tire.receiveShadow = true;
            wheelGroup.add(tire);

            const rim = new THREE.Mesh(rimGeo, rimMat);
            wheelGroup.add(rim);

            const hub = new THREE.Mesh(hubGeo, hubMat);
            wheelGroup.add(hub);

            const spokeCount = 5;
            for (let s = 0; s < spokeCount; s++) {
                const spoke = new THREE.Mesh(spokeGeo, spokeMat);
                const angle = (s / spokeCount) * Math.PI * 2;
                spoke.position.set(0, Math.sin(angle) * wheelRadius * 0.4, Math.cos(angle) * wheelRadius * 0.4);
                spoke.rotation.x = angle;
                wheelGroup.add(spoke);
            }

            this.carGroup.add(wheelGroup);
            this.wheels.push(wheelGroup as unknown as THREE.Mesh);
        }
    }

    public updateWheelRotation(amount: number): void {
        for (const wheel of this.wheels) {
            wheel.rotation.x += amount * 10;
        }
    }
}
