'use client';

import { useEffect, useId, useRef, useState } from 'react';

export function SwitchgearIllustration() {
  const instanceId = useId().replaceAll(':', '');
  const artRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    if (!('IntersectionObserver' in window)) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry?.isIntersecting ?? false),
      { rootMargin: '120px 0px' },
    );
    observer.observe(art);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="switchgear-art" data-in-view={isInView} ref={artRef}>
      <svg
        className="switchgear-art__drawing"
        role="img"
        aria-labelledby={`switchgear-title-${instanceId} switchgear-description-${instanceId}`}
        viewBox="0 0 680 560"
        fill="none"
      >
        <title id={`switchgear-title-${instanceId}`}>
          Условная инженерная схема электротехнического шкафа
        </title>
        <desc id={`switchgear-description-${instanceId}`}>
          Векторная схема шкафа управления с модульными аппаратами и
          DIN-рейками; она не изображает конкретную модель оборудования.
        </desc>
        <defs>
          <pattern
            id={`${instanceId}-grid`}
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path d="M28 0H0V28" stroke="var(--art-grid)" strokeWidth="1" />
          </pattern>
          <linearGradient
            id={`${instanceId}-face`}
            x1="190"
            y1="83"
            x2="470"
            y2="449"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--art-face-start)" />
            <stop offset="1" stopColor="var(--art-face-end)" />
          </linearGradient>
          <linearGradient
            id={`${instanceId}-side`}
            x1="465"
            y1="105"
            x2="539"
            y2="430"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--art-side-start)" />
            <stop offset="1" stopColor="var(--art-side-end)" />
          </linearGradient>
        </defs>
        <rect width="680" height="560" fill={`url(#${instanceId}-grid)`} />
        <circle
          className="switchgear-art__glow"
          cx="530"
          cy="122"
          r="83"
          fill="var(--art-glow)"
        />
        <path d="M82 453H598" stroke="var(--art-line-soft)" strokeWidth="1.5" />
        <path d="M142 478H536" stroke="var(--art-line-soft)" strokeWidth="1" />
        <path d="M159 435 190 449V477L159 464V435Z" fill="var(--art-base)" />
        <path
          d="M468 428 537 408V437L468 459V428Z"
          fill="var(--art-base-dark)"
        />
        <path
          className="switchgear-art__outline switchgear-art__outline--front"
          d="M190 88 462 72 537 104V408L468 434 190 449V88Z"
          fill={`url(#${instanceId}-face)`}
          stroke="var(--art-line)"
          strokeWidth="2"
        />
        <path
          className="switchgear-art__outline switchgear-art__outline--side"
          d="M462 72 537 104V408L468 434V104L462 72Z"
          fill={`url(#${instanceId}-side)`}
          stroke="var(--art-line)"
          strokeWidth="2"
        />
        <path
          className="switchgear-art__outline switchgear-art__outline--door"
          d="M215 112 443 99V410L215 422V112Z"
          fill="var(--art-door)"
          stroke="var(--art-line-soft)"
          strokeWidth="1.5"
        />
        <path
          d="M225 123 433 111V398L225 409V123Z"
          stroke="var(--art-door-line)"
          strokeWidth="1"
        />
        <path d="M418 238 425 237V272L418 273V238Z" fill="var(--art-handle)" />
        <path
          d="M432 154 483 138V180L432 196V154Z"
          fill="var(--art-panel)"
          stroke="var(--art-line)"
        />
        <circle cx="449" cy="169" r="5" fill="var(--art-accent)" />
        <circle cx="467" cy="163" r="5" fill="var(--art-indicator)" />
        <circle cx="485" cy="157" r="5" fill="var(--art-warning)" />
        <path
          d="M438 214 487 199M438 224 487 209"
          stroke="var(--art-line-soft)"
          strokeWidth="2"
        />
        <path
          d="M448 264 486 252V355L448 367V264Z"
          fill="var(--art-panel)"
          stroke="var(--art-line)"
        />
        <path
          d="M458 276 476 270V287L458 293V276ZM458 302 476 296V313L458 319V302ZM458 328 476 322V339L458 345V328Z"
          fill="var(--art-device)"
        />
        <path
          className="switchgear-art__outline switchgear-art__outline--inner"
          d="M245 147H385V365H245V147Z"
          fill="var(--art-inner)"
          stroke="var(--art-line-soft)"
          strokeWidth="1.5"
        />
        <circle
          className="switchgear-art__highlight"
          cx="316"
          cy="258"
          r="56"
          fill="var(--art-highlight)"
        />
        <path d="M258 161H372V202H258V161Z" fill="var(--art-rail)" />
        <path
          d="M264 171H366M264 181H366M264 191H366"
          stroke="var(--art-device-muted)"
          strokeWidth="1.5"
        />
        <path
          d="M258 205H372V210H258V205ZM258 261H372V266H258V261Z"
          fill="var(--art-base)"
          stroke="var(--art-line-soft)"
          strokeWidth="0.75"
        />
        <circle cx="263" cy="207.5" r="1.5" fill="var(--art-handle)" />
        <circle cx="367" cy="207.5" r="1.5" fill="var(--art-handle)" />
        <circle cx="263" cy="263.5" r="1.5" fill="var(--art-handle)" />
        <circle cx="367" cy="263.5" r="1.5" fill="var(--art-handle)" />
        <path
          d="M260 211H291V257H260V211ZM300 211H331V257H300V211ZM340 211H371V257H340V211Z"
          fill="var(--art-device)"
          stroke="var(--art-door-line)"
          strokeWidth="1"
        />
        <path
          d="M260 267H291V313H260V267ZM300 267H331V313H300V267ZM340 267H371V313H340V267Z"
          fill="var(--art-device-muted)"
          stroke="var(--art-door-line)"
          strokeWidth="1"
        />
        <path
          d="M267 216H284V222H267V216ZM307 216H324V222H307V216ZM347 216H364V222H347V216Z"
          fill="var(--art-panel)"
          stroke="var(--art-line-soft)"
          strokeWidth="0.75"
        />
        <path
          d="M273 222V232M313 222V232M353 222V232"
          stroke="var(--art-accent)"
          strokeLinecap="round"
          strokeWidth="3"
        />
        <path
          d="M264 239H287M304 239H327M344 239H367M264 247H287M304 247H327M344 247H367"
          stroke="var(--art-line-soft)"
          strokeWidth="1"
        />
        <path
          d="M264 274H287M304 274H327M344 274H367M264 305H287M304 305H327M344 305H367"
          stroke="var(--art-line-soft)"
          strokeWidth="1"
        />
        <circle cx="269" cy="283" r="1.5" fill="var(--art-handle)" />
        <circle cx="279" cy="283" r="1.5" fill="var(--art-handle)" />
        <circle cx="309" cy="283" r="1.5" fill="var(--art-handle)" />
        <circle cx="319" cy="283" r="1.5" fill="var(--art-handle)" />
        <circle cx="349" cy="283" r="1.5" fill="var(--art-handle)" />
        <circle cx="359" cy="283" r="1.5" fill="var(--art-handle)" />
        <path
          d="M276 202V211M316 202V211M356 202V211M276 257V267M316 257V267M356 257V267"
          stroke="var(--art-wire)"
          strokeWidth="2"
        />
        <path d="M260 324H371" stroke="var(--art-line)" strokeWidth="2" />
        <path
          d="M277 324V346M316 324V346M355 324V346"
          stroke="var(--art-wire)"
          strokeWidth="2"
        />
        <path d="M260 346H371" stroke="var(--art-accent)" strokeWidth="2" />
        <path
          className="switchgear-art__pulse"
          d="M260 346H371"
          pathLength="100"
          stroke="var(--art-pulse)"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
}
