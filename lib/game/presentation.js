const {renderStats,renderXpProgress,renderGrowth,growthLabel}=require('./pages');

function pigeonPresentation(pigeon) {
  if(!pigeon) return {};
  return {
    statsHtml:renderStats(pigeon),
    xpHtml:renderXpProgress(pigeon),
    growthHtml:renderGrowth(pigeon),
    growthLabel:growthLabel(pigeon)
  };
}
function presentPigeonResult(result) {
  return {...result,...pigeonPresentation(result?.pigeon)};
}

module.exports={pigeonPresentation,presentPigeonResult};
