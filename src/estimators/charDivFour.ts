export interface TokenEstimator {
  estimate(text: string): number;
}

export class CharDivFourEstimator implements TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export const defaultEstimator = new CharDivFourEstimator();
