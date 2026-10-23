/**
 * /cotecont : une chaîne, distances projetées, déplacement, explode, fichier.
 */
import { CadDocument } from '../src/core/document.ts';
import {
  createChainCote,
  createSingleCoteSegment,
  isChainDimension,
} from '../src/core/dimension.ts';
import { parseGkd, serializeGkd } from '../src/core/gkd.ts';
import type { DimensionEntity, DimensionStyle, TextEntity } from '../src/core/types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const style: DimensionStyle = {
  id: 'std',
  name: 'Standard',
  fontFamily: 'Arial',
  textColor: '#000000',
  textBackground: null,
  textHeight: 0.1,
  bold: false,
  italic: false,
  lineColor: '#000000',
  lineWidth: 1,
  lineStyle: 'plein',
  extensionOffset: 0,
  extensionOverhang: 0.05,
  tickSize: 0.08,
  textOffset: 0.05,
};

const chain = createChainCote(
  style,
  [0, -1, 0],
  [1, 0, 0],
  [
    [0, 0, 0],
    [1.2, 0.4, 0],
    [2, 0, 0],
  ],
  { unit: 'm' },
);
assert(chain, 'chaîne créée');
assert(chain.dim.mode === 'chain', 'mode chain');
assert(chain.dim.defPoints.length === 3, '3 points');
assert(chain.texts.length === 2, '2 libellés');
assert(chain.texts[0]!.content === '1.200 m', `segment 1 = ${chain.texts[0]!.content}`);
assert(chain.texts[1]!.content === '0.800 m', `segment 2 = ${chain.texts[1]!.content}`);
assert(chain.dim.labelIds?.length === 2, 'labelIds');
assert(chain.dim.labelId === chain.texts[0]!.id, 'labelId = premier');
assert(chain.texts.every((t) => t.dimId === chain.dim.id), 'dimId');
assert(isChainDimension(chain.dim), 'isChain');

const dropped = createChainCote(
  style,
  [0, 0, 0],
  [1, 0, 0],
  [
    [0, 0, 0],
    [0, 5, 0],
    [2, 0, 0],
  ],
);
assert(dropped && dropped.texts.length === 1, 'point sans avance ignoré');
assert(dropped.texts[0]!.content === '2.000 m', 'reste 2 m');

const single = createSingleCoteSegment(
  style,
  [0, 0, 0],
  [1, 0, 0],
  [0, 0, 0],
  [1, 0, 0],
);
assert(single && !isChainDimension(single.dim), 'cote simple non chaîne');

const doc = new CadDocument();
doc.addEntities([chain.dim, ...chain.texts]);
assert(doc.entities.length === 3, '3 entités');

doc.translateEntities([chain.dim.id], 5, 0, 0);
const movedDim = doc.entities.find((e) => e.kind === 'dimension') as DimensionEntity;
const movedTexts = doc.entities.filter((e) => e.kind === 'text') as TextEntity[];
assert(Math.abs(movedDim.lineAnchor[0] - 5) < 1e-9, 'ancre déplacée');
assert(Math.abs(movedDim.defPoints[0]![0] - 5) < 1e-9, 'defPoint déplacé');
assert(movedTexts.every((t) => Math.abs(t.position[0] - 5) > 0.1), 'textes suivent');

const firstText = movedTexts[0]!;
const kept = movedTexts[1]!;
doc.removeEntities([firstText.id]);
const afterDrop = doc.entities.find((e) => e.kind === 'dimension') as DimensionEntity;
assert(doc.entities.filter((e) => e.kind === 'text').length === 1, 'un texte reste');
assert(afterDrop.labelIds?.length === 1 && afterDrop.labelIds[0] === kept.id, 'labelIds resserré');
assert(afterDrop.labelId === kept.id, 'labelId resserré');

doc.removeEntities([afterDrop.id]);
assert(doc.entities.length === 0, 'suppression chaîne retire les textes');

const again = createChainCote(
  style,
  [0, -1, 0],
  [1, 0, 0],
  [
    [0, 0, 0],
    [1, 0, 0],
    [3, 0, 0],
  ],
  { unit: 'm' },
)!;
const shifted = { ...again.texts[0]!, position: [9, 9, 0] as [number, number, number] };
doc.addEntities([again.dim, shifted, again.texts[1]!]);
const parts = doc.entities;
const exploded = (
  await import('../src/core/dimension.ts')
).explodeChainDimension(again.dim, [shifted, again.texts[1]!]);
doc.replaceWith([again.dim.id], exploded);
const dims = doc.entities.filter((e) => e.kind === 'dimension') as DimensionEntity[];
const texts = doc.entities.filter((e) => e.kind === 'text') as TextEntity[];
assert(dims.length === 2 && dims.every((d) => d.mode === 'single'), '2 cotes simples');
assert(texts.length === 2, '2 textes après explode');
assert(texts.some((t) => t.position[0] === 9 && t.position[1] === 9), 'texte déplacé conservé');
assert(texts.some((t) => t.content === '2.000 m'), 'second segment 2 m');
assert(!doc.entities.some((e) => e.id === again.dim.id), 'chaîne retirée');
void parts;

const copyDoc = new CadDocument();
copyDoc.addEntities([chain.dim, ...chain.texts]);
const copies = copyDoc.copyEntities([chain.dim.id], 10, 0, 0);
const copyDim = copies.find((e) => e.kind === 'dimension') as DimensionEntity;
const copyTexts = copies.filter((e) => e.kind === 'text') as TextEntity[];
assert(copyTexts.length === 2, 'copie des 2 textes');
assert(copyDim.labelIds?.length === 2, 'labelIds copiés');
assert(copyTexts.every((t) => t.dimId === copyDim.id), 'nouveaux liens');
assert(copyDim.labelIds!.every((id) => copyTexts.some((t) => t.id === id)), 'ids reliés');

const round = parseGkd(serializeGkd(copyDoc.raw));
const roundDim = round.entities.find((e) => e.kind === 'dimension' && e.mode === 'chain') as DimensionEntity;
assert(roundDim.labelIds?.length === 2, 'labelIds dans le .gkd');

console.log('OK cotecont');
