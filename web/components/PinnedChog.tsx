"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const ART = [
  { image: "chog-01.png", label: "Angel Chog", number: "#1159", className: "board-chog-one" },
  { image: "chog-02.png", label: "Devil Chog", number: "#1376", className: "board-chog-two" },
  { image: "chog-03.png", label: "Laser eyes", number: "#143", className: "board-chog-three" },
  { image: "chog-04.png", label: "Great again", number: "#067", className: "board-chog-four" },
  { image: "chog-05.png", label: "Happy Chog", number: "#909", className: "board-chog-five" },
];

export function PinnedChog() {
  const [shuffle, setShuffle] = useState<number[]>([0, 1, 2, 3, 4]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShuffle([...ART.keys()].sort(() => Math.random() - 0.5));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <aside className="chog-board mb-8" aria-label="Pinned Chog artwork board">
      <div className="chog-board-header">
        <div>
          <p className="pinned-chog-kicker">Chog swap board</p>
          <p className="text-sm text-muted">A few characters pinned up while you browse.</p>
        </div>
        <span className="chog-board-pin" aria-hidden>✦</span>
      </div>
      <div className="chog-board-canvas">
        {shuffle.map((artIndex) => {
          const art = ART[artIndex];
          return (
            <div key={art.image} className={`board-chog ${art.className}`}>
              <div className="board-tape" aria-hidden />
              <div className="board-image">
                <Image
                  src={`/art/chogs/${art.image}`}
                  alt={`${art.label} Chog ${art.number}`}
                  fill
                  sizes="180px"
                  className="object-cover"
                />
              </div>
              <div className="board-label">
                <span>{art.label}</span>
                <span className="font-mono">{art.number}</span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
