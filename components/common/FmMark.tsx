import React, { useId } from 'react';

// Značka FrameMind jako vektor. Obrys je vytrasovaný z originálního loga
// (loga FrameMind/Bez tecky/framemind-cs.png), barvy nese drobné barevné pole
// z téhož originálu — hrany jsou ostré v jakékoli velikosti, přechod barev věrný.
const MARK_PATH =
  'M244.0 304.5 L301.0 387.0 L303.2 388.8 L389.2 304.2 L244.2 303.8Z M388.2 172.2 L387.2 172.2 L313.5 290.2 L313.8 291.0 L394.5 291.2 L396.0 290.5 L401.8 274.0 L405.0 260.2 L407.0 242.2 L407.0 232.2 L405.0 215.0 L401.0 199.5 L397.0 188.8Z M603.0 119.2 L601.8 119.0 L405.2 306.8 L302.5 407.0 L301.2 406.5 L283.0 382.2 L243.0 326.0 L218.2 288.8 L193.0 247.0 L172.2 275.5 L144.5 316.0 L144.2 317.5 L223.2 398.2 L280.0 458.0 L308.0 485.5 L353.5 445.8 L416.2 388.8 L529.5 281.2 L529.8 465.5 L530.8 466.2 L602.2 466.2 L603.0 465.5Z M289.5 179.0 L251.0 116.2 L248.8 115.8 L235.0 119.0 L222.0 124.0 L207.8 131.0 L195.2 138.8 L182.0 149.0 L174.0 156.8 L162.8 169.8 L156.0 178.8 L156.0 179.8 L288.5 180.0Z M265.5 113.2 L267.2 117.5 L335.2 227.8 L336.5 228.0 L379.0 160.0 L379.2 158.2 L366.2 145.0 L356.2 137.2 L341.2 128.0 L325.5 121.0 L308.5 116.0 L291.2 113.2Z M646.0 28.2 L638.0 21.0 L627.2 16.5 L615.8 15.8 L609.0 17.0 L603.8 19.0 L598.0 22.5 L593.2 27.0 L589.5 32.0 L586.2 38.5 L584.5 46.2 L584.2 52.0 L585.2 58.5 L588.0 66.5 L562.8 91.5 L508.5 92.0 L447.0 156.2 L446.5 200.0 L448.2 199.2 L455.0 186.2 L460.0 172.8 L462.2 163.2 L516.0 107.8 L568.8 107.5 L598.0 78.8 L609.8 83.8 L622.2 84.8 L631.2 82.8 L641.5 76.8 L647.0 71.0 L651.0 64.5 L654.0 53.8 L653.0 41.5 L650.0 34.0Z M616.8 30.8 L623.5 31.0 L630.8 34.0 L636.2 39.8 L638.2 43.8 L639.2 48.5 L638.2 56.8 L635.2 62.0 L628.5 67.8 L621.2 70.0 L612.2 69.0 L606.8 66.0 L602.2 61.2 L599.2 53.0 L600.0 45.0 L603.2 38.5 L608.0 34.0Z M377.8 0.0 L0.2 0.5 L0.2 466.2 L7.5 460.8 L90.2 388.0 L90.0 282.2 L90.8 281.5 L138.5 281.0 L220.0 193.5 L90.2 193.0 L89.8 88.2 L90.5 87.5 L291.2 87.5Z';

const COLOR_FIELD = 'data:image/webp;base64,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';

const FmMark: React.FC<{ className?: string; title?: string }> = ({ className = 'h-7 w-auto', title }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 654.0 485.5" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={`fm-mark-${id}`}>
          <path d={MARK_PATH} fillRule="evenodd" clipRule="evenodd" />
        </clipPath>
      </defs>
      <image
        href={COLOR_FIELD}
        width="654.0"
        height="485.5"
        preserveAspectRatio="none"
        clipPath={`url(#fm-mark-${id})`}
      />
    </svg>
  );
};

export default FmMark;
