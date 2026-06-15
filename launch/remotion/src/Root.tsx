import { Composition } from "remotion";
import { Clip } from "./Clip";

export const RemotionRoot: React.FC = () => (
  <Composition id="Clip" component={Clip} durationInFrames={1310} fps={30} width={1920} height={1080} />
);
