/** Runs an async listener and swallows rejection into the console. */
export function voidAsync<Args extends unknown[]>(
	fn: (...args: Args) => Promise<void>,
): (...args: Args) => void {
	return (...args: Args) => {
		void fn(...args);
	};
}
