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
			{/* Game container */}
			<div ref={containerRef} className="w-full h-full" />

			{/* UI Overlay */}
			<div className="absolute flex flex-col top-2 left-2 w-full max-w-sm p-4 bg-white/40 backdrop-blur-sm rounded-lg">
				<div className="w-full flex items-center gap-4">
					<Car className="w-6 h-6 text-yellow-400" />
					<h1 className="text-white text-xl font-bold">Micro Machines 3D</h1>
				</div>
				<div className="flex flex-col gap-2 mt-6">
					<p className="text-white text-sm">
						Controls: Q/A or ↑/↓ to drive, O/P or ←/→ to steer, Space to drift,
						C to toggle free camera
					</p>
					<p className="text-white text-sm mt-6">
						Press C to toggle camera mode. In free mode, use mouse to rotate and
						zoom.
					</p>
				</div>
			</div>
		</div>
	);
}

export default App;
