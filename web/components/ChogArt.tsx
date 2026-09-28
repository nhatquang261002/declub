import Image from "next/image";

export function ChogSwapArt({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`chog-art ${compact ? "chog-art-compact" : ""}`} aria-hidden>
      <div className="chog-art-glow" />
      <div className="chog-art-token chog-art-token-left">#1159</div>
      <div className="chog-art-token chog-art-token-right">#1376</div>
      <div className="chog-art-chog chog-art-chog-left">
        <div className="chog-art-tape" aria-hidden />
        <div className="chog-art-image">
          <Image src="/art/chogs/chog-01.png" alt="" fill sizes="180px" />
        </div>
        <div className="chog-art-label">ANGEL CHOG</div>
      </div>
      <div className="chog-art-chog chog-art-chog-right">
        <div className="chog-art-tape" aria-hidden />
        <div className="chog-art-image">
          <Image src="/art/chogs/chog-02.png" alt="" fill sizes="180px" />
        </div>
        <div className="chog-art-label">DEVIL CHOG</div>
      </div>
      <div className="chog-art-arrows" aria-hidden>
        <span className="chog-art-arrow chog-art-arrow-left">→</span>
        <span className="chog-art-arrow chog-art-arrow-right">←</span>
      </div>
      <div className="chog-art-spark chog-art-spark-one">✦</div>
      <div className="chog-art-spark chog-art-spark-two">✦</div>
      <div className="chog-art-caption">atomic swap</div>
    </div>
  );
}
