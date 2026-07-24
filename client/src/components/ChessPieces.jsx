import React from 'react';

// Crisp SVG Chess Pieces
export const PieceSVG = ({ type, color }) => {
  const isWhite = color === 'w';

  // Vector paths for standard Staunton chess set
  if (type === 'p') {
    return (
      <svg className="piece-svg" viewBox="0 0 45 45">
        <path
          d="M 22.5,9 C 23.88,9 25,10.12 25,11.5 C 25,12.88 23.88,14 22.5,14 C 21.12,14 20,12.88 20,11.5 C 20,10.12 21.12,9 22.5,9 z M 24,14.5 C 25,15.5 25.5,17 25.5,18.5 C 25.5,20 24.5,21.5 23.5,22.5 L 29,36 L 16,36 L 21.5,22.5 C 20.5,21.5 19.5,20 19.5,18.5 C 19.5,17 20,15.5 21,14.5 L 24,14.5 z M 12,38 L 33,38 L 33,40 L 12,40 Z"
          fill={isWhite ? "#ffffff" : "#1e293b"}
          stroke={isWhite ? "#1e293b" : "#ffffff"}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === 'n') {
    return (
      <svg className="piece-svg" viewBox="0 0 45 45">
        <path
          d="M 22,10 C 32.5,11 38.5,18 31,30 C 36.5,30 36.5,35 36.5,35 L 8.5,35 C 8.5,35 8.5,30 14,30 C 6.5,18 12.5,11 23,10 z M 24,14 C 21.5,14 19.5,16 19.5,18.5 C 19.5,21 21.5,23 24,23 C 26.5,23 28.5,21 28.5,18.5 C 28.5,16 26.5,14 24,14 z M 12,38 L 33,38 L 33,40 L 12,40 Z"
          fill={isWhite ? "#ffffff" : "#1e293b"}
          stroke={isWhite ? "#1e293b" : "#ffffff"}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (type === 'b') {
    return (
      <svg className="piece-svg" viewBox="0 0 45 45">
        <g fill={isWhite ? "#ffffff" : "#1e293b"} stroke={isWhite ? "#1e293b" : "#ffffff"} strokeWidth="1.5" strokeLinejoin="round">
          <circle cx="22.5" cy="8" r="2.5" />
          <path d="M 9,36 C 9,36 9,28 17,23 C 17,23 15,16 22.5,13.5 C 30,16 28,23 28,23 C 36,28 36,36 36,36 L 9,36 z" />
          <path d="M 12,38 L 33,38 L 33,40 L 12,40 Z" />
        </g>
      </svg>
    );
  }

  if (type === 'r') {
    return (
      <svg className="piece-svg" viewBox="0 0 45 45">
        <g fill={isWhite ? "#ffffff" : "#1e293b"} stroke={isWhite ? "#1e293b" : "#ffffff"} strokeWidth="1.5" strokeLinejoin="round">
          <path d="M 9,36 L 36,36 L 36,25 L 31,25 L 31,17 L 34,17 L 34,9 L 29,9 L 29,13 L 25,13 L 25,9 L 20,9 L 20,13 L 16,13 L 16,9 L 11,9 L 11,17 L 14,17 L 14,25 L 9,25 L 9,36 z" />
          <path d="M 12,38 L 33,38 L 33,40 L 12,40 Z" />
        </g>
      </svg>
    );
  }

  if (type === 'q') {
    return (
      <svg className="piece-svg" viewBox="0 0 45 45">
        <g fill={isWhite ? "#ffffff" : "#1e293b"} stroke={isWhite ? "#1e293b" : "#ffffff"} strokeWidth="1.5" strokeLinejoin="round">
          <path d="M 9,26 L 11.5,13 L 17.5,21.5 L 22.5,10 L 27.5,21.5 L 33.5,13 L 36,26 L 9,26 z" />
          <path d="M 9,28 L 36,28 L 36,35 L 9,35 Z" />
          <path d="M 12,38 L 33,38 L 33,40 L 12,40 Z" />
          <circle cx="11.5" cy="11" r="2" />
          <circle cx="17.5" cy="19.5" r="2" />
          <circle cx="22.5" cy="8" r="2" />
          <circle cx="27.5" cy="19.5" r="2" />
          <circle cx="33.5" cy="11" r="2" />
        </g>
      </svg>
    );
  }

  if (type === 'k') {
    return (
      <svg className="piece-svg" viewBox="0 0 45 45">
        <g fill={isWhite ? "#ffffff" : "#1e293b"} stroke={isWhite ? "#1e293b" : "#ffffff"} strokeWidth="1.5" strokeLinejoin="round">
          {/* Cross */}
          <path d="M 22.5,6 L 22.5,12 M 19.5,9 L 25.5,9" strokeWidth="2" />
          <path d="M 11.5,30 C 15,29 16,23 22.5,20.5 C 29,23 30,29 33.5,30 C 34.5,31 36,31 36,33 L 9,33 C 9,31 10.5,31 11.5,30 z" />
          <path d="M 12,36 L 33,36 L 33,38 L 12,38 Z" />
        </g>
      </svg>
    );
  }

  return null;
};
