export function SwitchgearIllustration() {
  return (
    <div className="switchgear-art">
      <div className="switchgear-art__caption">
        <span>Graphite &amp; Petrol</span>
        <span>01 / 03</span>
      </div>
      <svg
        className="switchgear-art__drawing"
        role="img"
        aria-labelledby="switchgear-title switchgear-description"
        viewBox="0 0 680 560"
        fill="none"
      >
        <title id="switchgear-title">Инженерная схема электрощита</title>
        <desc id="switchgear-description">
          Оригинальная векторная иллюстрация шкафа управления с дверцей,
          индикаторами и внутренними электрическими линиями.
        </desc>
        <defs>
          <pattern
            id="switchgear-grid"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <path d="M28 0H0V28" stroke="var(--art-grid)" strokeWidth="1" />
          </pattern>
          <linearGradient
            id="cabinet-face"
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
            id="cabinet-side"
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
        <rect width="680" height="560" fill="url(#switchgear-grid)" />
        <circle cx="530" cy="122" r="83" fill="var(--art-glow)" />
        <path d="M82 453H598" stroke="var(--art-line-soft)" strokeWidth="1.5" />
        <path d="M142 478H536" stroke="var(--art-line-soft)" strokeWidth="1" />
        <path d="M159 435 190 449V477L159 464V435Z" fill="var(--art-base)" />
        <path
          d="M468 428 537 408V437L468 459V428Z"
          fill="var(--art-base-dark)"
        />
        <path
          d="M190 88 462 72 537 104V408L468 434 190 449V88Z"
          fill="url(#cabinet-face)"
          stroke="var(--art-line)"
          strokeWidth="2"
        />
        <path
          d="M462 72 537 104V408L468 434V104L462 72Z"
          fill="url(#cabinet-side)"
          stroke="var(--art-line)"
          strokeWidth="2"
        />
        <path
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
          d="M245 147H385V365H245V147Z"
          fill="var(--art-inner)"
          stroke="var(--art-line-soft)"
          strokeWidth="1.5"
        />
        <path d="M258 161H372V202H258V161Z" fill="var(--art-rail)" />
        <path
          d="M260 211H291V257H260V211ZM300 211H331V257H300V211ZM340 211H371V257H340V211Z"
          fill="var(--art-device)"
        />
        <path
          d="M260 267H291V313H260V267ZM300 267H331V313H300V267ZM340 267H371V313H340V267Z"
          fill="var(--art-device-muted)"
        />
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
          d="M186 114H167V151M186 394H167V370M492 88 561 64M532 377 575 362"
          stroke="var(--art-accent)"
          strokeWidth="1.5"
        />
        <circle cx="167" cy="151" r="3" fill="var(--art-accent)" />
        <circle cx="167" cy="370" r="3" fill="var(--art-accent)" />
        <circle cx="561" cy="64" r="3" fill="var(--art-accent)" />
        <circle cx="575" cy="362" r="3" fill="var(--art-accent)" />
      </svg>
      <div className="switchgear-art__legend" aria-hidden="true">
        <span>
          <i className="legend-dot legend-dot--petrol" /> Электрические системы
        </span>
        <span>
          <i className="legend-dot legend-dot--silver" /> Инженерная проработка
        </span>
      </div>
    </div>
  );
}
