import { LargeBashOutputDetector } from "./largeBashOutput.js";
import { FullTestSuiteRerunDetector } from "./fullTestSuiteRerun.js";
import { RepeatedFileReadDetector } from "./repeatedFileRead.js";
import { LargeFileReadDetector } from "./largeFileRead.js";
import { BroadGrepOrGlobDetector } from "./broadGrepOrGlob.js";
import { ContextGrowthSpikeDetector } from "./contextGrowthSpike.js";
import { LongSessionDragDetector } from "./longSessionDrag.js";
import { ExpensiveToolLoopDetector } from "./expensiveToolLoop.js";
import { PostCompactionRereadDetector } from "./postCompactionReread.js";
import { CacheWriteSpikeDetector } from "./cacheWriteSpike.js";
import type { Detector } from "../engine.js";

export function createDefaultDetectors(): Detector[] {
  return [
    new RepeatedFileReadDetector(),
    new LargeBashOutputDetector(),
    new FullTestSuiteRerunDetector(),
    new LargeFileReadDetector(),
    new BroadGrepOrGlobDetector(),
    new ContextGrowthSpikeDetector(),
    new LongSessionDragDetector(),
    new ExpensiveToolLoopDetector(),
    new PostCompactionRereadDetector(),
    new CacheWriteSpikeDetector(),
  ];
}

export {
  LargeBashOutputDetector,
  FullTestSuiteRerunDetector,
  RepeatedFileReadDetector,
  LargeFileReadDetector,
  BroadGrepOrGlobDetector,
  ContextGrowthSpikeDetector,
  LongSessionDragDetector,
  ExpensiveToolLoopDetector,
  PostCompactionRereadDetector,
  CacheWriteSpikeDetector,
};
