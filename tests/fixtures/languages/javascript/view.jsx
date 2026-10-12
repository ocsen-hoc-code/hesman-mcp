import { useState } from 'react';

/** Label shown on the button for a given count. */
function labelFor(count) {
  return count === 1 ? '1 click' : `${count} clicks`;
}

/** A button that counts its clicks. */
export function Counter({ start = 0 }) {
  const [count, setCount] = useState(start);
  const increment = () => setCount(count + 1);
  return (
    <button type="button" onClick={increment}>
      {labelFor(count)}
    </button>
  );
}

/** Two counters side by side. */
export const CounterPair = () => (
  <div className="pair">
    <Counter />
    <Counter start={10} />
  </div>
);
