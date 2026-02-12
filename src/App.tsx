import { useEffect, useRef } from "react";
import { GameEngine } from "./game/GameEngine";
import { Car } from "./icons/Car";

function App() {
	const containerRef = useRef<HTMLDivElement>(null);
	const gameRef = useRef<GameEngine | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		// Initialize game engine
		gameRef.current = new GameEngine(containerRef.current);

		// Start the game loop
		gameRef.current.start();

		// Clean up on unmount
		return () => {
			if (gameRef.current) {
				gameRef.current.dispose();
			}
		};
	}, []);

	return (
		<div className="relative w-full h-screen bg-black overflow-hidden">
			<div ref={containerRef} className="w-full h-full" />

			<div className="absolute top-3 left-3 flex flex-col gap-3 pointer-events-none select-none">
				<div className="flex items-center gap-2.5 px-3 py-2 bg-black/60 backdrop-blur-sm rounded-md border border-white/10">
					<Car className="w-5 h-5 text-yellow-400" />
					<h1 className="text-white/95 text-base font-semibold tracking-wide">Micro Machines 3D</h1>
				</div>

				<div className="flex flex-col gap-1.5 px-3 py-2.5 bg-black/50 backdrop-blur-sm rounded-md border border-white/10 text-xs">
					<div className="flex gap-3">
						<span className="text-white/50 w-10">Drive</span>
						<span className="text-white/90 font-mono">Q / A</span>
						<span className="text-white/40">or</span>
						<span className="text-white/90 font-mono">↑ / ↓</span>
					</div>
					<div className="flex gap-3">
						<span className="text-white/50 w-10">Steer</span>
						<span className="text-white/90 font-mono">O / P</span>
						<span className="text-white/40">or</span>
						<span className="text-white/90 font-mono">← / →</span>
					</div>
					<div className="flex gap-3">
						<span className="text-white/50 w-10">Drift</span>
						<span className="text-white/90 font-mono">Space</span>
					</div>
					<div className="flex gap-3">
						<span className="text-white/50 w-10">Camera</span>
						<span className="text-white/90 font-mono">C</span>
						<span className="text-white/50 text-[10px] ml-1">free cam mode</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export default App;
