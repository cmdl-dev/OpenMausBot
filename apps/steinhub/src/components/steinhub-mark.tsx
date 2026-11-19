import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "@/theme";

export function SteinHubMark({ size = 72, color = colors.text }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="SteinHub">
      <Path d="M16 2.8 27.4 9.4v13.2L16 29.2 4.6 22.6V9.4z" fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M16 16V8.6M16 16l-6.4 3.7M16 16l6.4 3.7" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Circle cx={16} cy={16} r={3} fill={color} />
    </Svg>
  );
}
