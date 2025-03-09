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
			<div className="absolute top-0 left-0 w-full p-4">
				<div className="flex justify-between items-center">
					<div className="flex items-center gap-2 bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg">
						<Car className="w-6 h-6 text-yellow-400" />
						<h1 className="text-white text-xl font-bold">Micro Machines 3D</h1>
					</div>

					<div className="bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg">
						<p className="text-white text-sm">
							Controls: Q/A or ↑/↓ to drive, O/P or ←/→ to steer, Space to
							brake, C to toggle free camera
						</p>
					</div>
				</div>
			</div>

			{/* Camera Mode Indicator */}
			<div className="absolute bottom-4 right-4 bg-white/10 backdrop-blur-sm px-3 py-2 rounded-lg">
				<p className="text-white text-sm">
					Press C to toggle camera mode. In free mode, use mouse to rotate and
					zoom.
				</p>
			</div>
		</div>
	);
}

export default App;
