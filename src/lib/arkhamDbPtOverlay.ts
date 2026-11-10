import { forEach } from 'lodash';
import { CoreCardTextFragment } from '@generated/graphql/apollo-schema';

const FORK_OWNER = 'gustavo-serra';
const FORK_REPO = 'arkhamdb-json-data';
const FORK_BRANCH = 'pt-br-app';

const TREE_API_URL = `https://api.github.com/repos/${FORK_OWNER}/${FORK_REPO}/git/trees/${FORK_BRANCH}?recursive=1`;
const RAW_BASE_URL = `https://raw.githubusercontent.com/${FORK_OWNER}/${FORK_REPO}/${FORK_BRANCH}`;

const FETCH_TIMEOUT_MS = 10000;
const BATCH_SIZE = 20;

const FALLBACK_PT_JSON_PATHS: string[] = [
  'translations/pt/cycles.json',
  'translations/pt/encounters.json',
  'translations/pt/factions.json',
  'translations/pt/packs.json',
  'translations/pt/subtypes.json',
  'translations/pt/types.json',
  'translations/pt/pack/core/core.json',
  'translations/pt/pack/core/core_encounter.json',
  'translations/pt/pack/core/rcore.json',
  'translations/pt/pack/dwl/bota.json',
  'translations/pt/pack/dwl/bota_encounter.json',
  'translations/pt/pack/dwl/dwl.json',
  'translations/pt/pack/dwl/dwl_encounter.json',
  'translations/pt/pack/dwl/litas.json',
  'translations/pt/pack/dwl/litas_encounter.json',
  'translations/pt/pack/dwl/tece.json',
  'translations/pt/pack/dwl/tece_encounter.json',
  'translations/pt/pack/dwl/tmm.json',
  'translations/pt/pack/dwl/tmm_encounter.json',
  'translations/pt/pack/dwl/uau.json',
  'translations/pt/pack/dwl/uau_encounter.json',
  'translations/pt/pack/dwl/wda.json',
  'translations/pt/pack/dwl/wda_encounter.json',
  'translations/pt/pack/eoe/eoec.json',
  'translations/pt/pack/eoe/eoep.json',
  'translations/pt/pack/fhv/fhvc.json',
  'translations/pt/pack/fhv/fhvp.json',
  'translations/pt/pack/investigator/har.json',
  'translations/pt/pack/investigator/jac.json',
  'translations/pt/pack/investigator/nat.json',
  'translations/pt/pack/investigator/ste.json',
  'translations/pt/pack/investigator/win.json',
  'translations/pt/pack/parallel/aof.json',
  'translations/pt/pack/parallel/aon.json',
  'translations/pt/pack/parallel/aon_encounter.json',
  'translations/pt/pack/parallel/bad.json',
  'translations/pt/pack/parallel/bad_encounter.json',
  'translations/pt/pack/parallel/btb.json',
  'translations/pt/pack/parallel/btb_encounter.json',
  'translations/pt/pack/parallel/hfa.json',
  'translations/pt/pack/parallel/ltr.json',
  'translations/pt/pack/parallel/ltr_encounter.json',
  'translations/pt/pack/parallel/otr.json',
  'translations/pt/pack/parallel/pap.json',
  'translations/pt/pack/parallel/ptr.json',
  'translations/pt/pack/parallel/rod.json',
  'translations/pt/pack/parallel/rod_encounter.json',
  'translations/pt/pack/parallel/rop.json',
  'translations/pt/pack/parallel/rop_encounter.json',
  'translations/pt/pack/parallel/rtr.json',
  'translations/pt/pack/parallel/rtr_encounter.json',
  'translations/pt/pack/promo/bob.json',
  'translations/pt/pack/promo/dre.json',
  'translations/pt/pack/promo/hoth.json',
  'translations/pt/pack/promo/iotv.json',
  'translations/pt/pack/promo/promo.json',
  'translations/pt/pack/promo/tdg.json',
  'translations/pt/pack/promo/tdor.json',
  'translations/pt/pack/promo/tftbw.json',
  'translations/pt/pack/ptc/apot.json',
  'translations/pt/pack/ptc/apot_encounter.json',
  'translations/pt/pack/ptc/bsr.json',
  'translations/pt/pack/ptc/bsr_encounter.json',
  'translations/pt/pack/ptc/dca.json',
  'translations/pt/pack/ptc/dca_encounter.json',
  'translations/pt/pack/ptc/eotp.json',
  'translations/pt/pack/ptc/eotp_encounter.json',
  'translations/pt/pack/ptc/ptc.json',
  'translations/pt/pack/ptc/ptc_encounter.json',
  'translations/pt/pack/ptc/tpm.json',
  'translations/pt/pack/ptc/tpm_encounter.json',
  'translations/pt/pack/ptc/tuo.json',
  'translations/pt/pack/ptc/tuo_encounter.json',
  'translations/pt/pack/return/rtdwl.json',
  'translations/pt/pack/return/rtdwl_encounter.json',
  'translations/pt/pack/return/rtnotz.json',
  'translations/pt/pack/return/rtnotz_encounter.json',
  'translations/pt/pack/return/rtptc.json',
  'translations/pt/pack/return/rtptc_encounter.json',
  'translations/pt/pack/return/rttcu.json',
  'translations/pt/pack/return/rttcu_encounter.json',
  'translations/pt/pack/return/rttfa.json',
  'translations/pt/pack/return/rttfa_encounter.json',
  'translations/pt/pack/side/blbe.json',
  'translations/pt/pack/side/blbe_encounter.json',
  'translations/pt/pack/side/blob_encounter.json',
  'translations/pt/pack/side/coh_encounter.json',
  'translations/pt/pack/side/cotr_encounter.json',
  'translations/pt/pack/side/fof_encounter.json',
  'translations/pt/pack/side/guardians_encounter.json',
  'translations/pt/pack/side/hotel_encounter.json',
  'translations/pt/pack/side/lol_encounter.json',
  'translations/pt/pack/side/mtt_encounter.json',
  'translations/pt/pack/side/tmg_encounter.json',
  'translations/pt/pack/side/wog_encounter.json',
  'translations/pt/pack/tcu/bbt.json',
  'translations/pt/pack/tcu/bbt_encounter.json',
  'translations/pt/pack/tcu/fgg.json',
  'translations/pt/pack/tcu/fgg_encounter.json',
  'translations/pt/pack/tcu/icc.json',
  'translations/pt/pack/tcu/icc_encounter.json',
  'translations/pt/pack/tcu/tcu.json',
  'translations/pt/pack/tcu/tcu_encounter.json',
  'translations/pt/pack/tcu/tsn.json',
  'translations/pt/pack/tcu/tsn_encounter.json',
  'translations/pt/pack/tcu/uad.json',
  'translations/pt/pack/tcu/uad_encounter.json',
  'translations/pt/pack/tcu/wos.json',
  'translations/pt/pack/tcu/wos_encounter.json',
  'translations/pt/pack/tdc/tdcc.json',
  'translations/pt/pack/tdc/tdcp.json',
  'translations/pt/pack/tde/dsm.json',
  'translations/pt/pack/tde/dsm_encounter.json',
  'translations/pt/pack/tde/pnr.json',
  'translations/pt/pack/tde/pnr_encounter.json',
  'translations/pt/pack/tde/sfk.json',
  'translations/pt/pack/tde/sfk_encounter.json',
  'translations/pt/pack/tde/tde.json',
  'translations/pt/pack/tde/tde_encounter.json',
  'translations/pt/pack/tde/tsh.json',
  'translations/pt/pack/tde/tsh_encounter.json',
  'translations/pt/pack/tde/wgd.json',
  'translations/pt/pack/tde/wgd_encounter.json',
  'translations/pt/pack/tde/woc.json',
  'translations/pt/pack/tde/woc_encounter.json',
  'translations/pt/pack/tfa/hote.json',
  'translations/pt/pack/tfa/hote_encounter.json',
  'translations/pt/pack/tfa/sha.json',
  'translations/pt/pack/tfa/sha_encounter.json',
  'translations/pt/pack/tfa/tbb.json',
  'translations/pt/pack/tfa/tbb_encounter.json',
  'translations/pt/pack/tfa/tcoa.json',
  'translations/pt/pack/tfa/tcoa_encounter.json',
  'translations/pt/pack/tfa/tdoy.json',
  'translations/pt/pack/tfa/tdoy_encounter.json',
  'translations/pt/pack/tfa/tfa.json',
  'translations/pt/pack/tfa/tfa_encounter.json',
  'translations/pt/pack/tfa/tof.json',
  'translations/pt/pack/tfa/tof_encounter.json',
  'translations/pt/pack/tic/def.json',
  'translations/pt/pack/tic/def_encounter.json',
  'translations/pt/pack/tic/hhg.json',
  'translations/pt/pack/tic/hhg_encounter.json',
  'translations/pt/pack/tic/itd.json',
  'translations/pt/pack/tic/itd_encounter.json',
  'translations/pt/pack/tic/itm.json',
  'translations/pt/pack/tic/itm_encounter.json',
  'translations/pt/pack/tic/lif.json',
  'translations/pt/pack/tic/lif_encounter.json',
  'translations/pt/pack/tic/lod.json',
  'translations/pt/pack/tic/lod_encounter.json',
  'translations/pt/pack/tic/tic.json',
  'translations/pt/pack/tic/tic_encounter.json',
  'translations/pt/pack/tsk/tskc.json',
  'translations/pt/pack/tsk/tskp.json',
];

interface NamedCodeEntry {
  code: string;
  name: string;
}

export interface ArkhamDbCardTranslationEntry {
  code: string;
  name?: string | null;
  subname?: string | null;
  text?: string | null;
  traits?: string | null;
  flavor?: string | null;
  slot?: string | null;
  back_name?: string | null;
  back_subname?: string | null;
  back_text?: string | null;
  back_traits?: string | null;
  back_flavor?: string | null;
  customization_text?: string | null;
  customization_change?: string | null;
  taboo_text_change?: string | null;
  taboo_original_text?: string | null;
  taboo_original_back_text?: string | null;
  errata_date?: string | null;
}

interface GitHubTreeEntry {
  path: string;
  type: string;
  sha: string;
}

interface GitHubTreeResponse {
  sha?: string;
  tree?: GitHubTreeEntry[];
}

export interface ArkhamDbPtOverlay {
  treeSha?: string;
  cycles: { [code: string]: string | undefined };
  packs: { [code: string]: string | undefined };
  encounters: { [code: string]: string | undefined };
  factions: { [code: string]: string | undefined };
  types: { [code: string]: string | undefined };
  subtypes: { [code: string]: string | undefined };
  cards: { [code: string]: ArkhamDbCardTranslationEntry | undefined };
}

async function fetchJsonWithTimeout<T>(url: string, headers?: Record<string, string>): Promise<T | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as T;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toNameMap(entries: NamedCodeEntry[] | undefined): { [code: string]: string | undefined } {
  const result: { [code: string]: string | undefined } = {};
  if (!Array.isArray(entries)) {
    return result;
  }
  forEach(entries, entry => {
    if (entry && entry.code && entry.name) {
      result[entry.code] = entry.name;
    }
  });
  return result;
}

export async function getArkhamDbPtForkTreeInfo(): Promise<{
  sha?: string;
  paths: string[];
}> {
  const data = await fetchJsonWithTimeout<GitHubTreeResponse>(TREE_API_URL, {
    Accept: 'application/vnd.github+json',
  });
  if (data && Array.isArray(data.tree) && data.tree.length > 0) {
    const ptPaths: string[] = [];
    forEach(data.tree, entry => {
      if (
        entry.type === 'blob' &&
        entry.path.startsWith('translations/pt/') &&
        entry.path.endsWith('.json')
      ) {
        ptPaths.push(entry.path);
      }
    });
    if (ptPaths.length > 0) {
      return {
        sha: data.sha,
        paths: ptPaths,
      };
    }
  }
  return {
    sha: undefined,
    paths: FALLBACK_PT_JSON_PATHS,
  };
}

export async function fetchArkhamDbPtOverlay(): Promise<ArkhamDbPtOverlay | undefined> {
  const { sha, paths } = await getArkhamDbPtForkTreeInfo();
  const overlay: ArkhamDbPtOverlay = {
    treeSha: sha,
    cycles: {},
    packs: {},
    encounters: {},
    factions: {},
    types: {},
    subtypes: {},
    cards: {},
  };

  let loadedAnyFile = false;
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async filePath => {
        const json = await fetchJsonWithTimeout<unknown>(`${RAW_BASE_URL}/${filePath}`);
        return { filePath, json };
      })
    );

    forEach(results, ({ filePath, json }) => {
      if (!json) {
        return;
      }
      loadedAnyFile = true;
      if (filePath === 'translations/pt/cycles.json') {
        overlay.cycles = toNameMap(json as NamedCodeEntry[]);
      } else if (filePath === 'translations/pt/packs.json') {
        overlay.packs = toNameMap(json as NamedCodeEntry[]);
      } else if (filePath === 'translations/pt/encounters.json') {
        overlay.encounters = toNameMap(json as NamedCodeEntry[]);
      } else if (filePath === 'translations/pt/factions.json') {
        overlay.factions = toNameMap(json as NamedCodeEntry[]);
      } else if (filePath === 'translations/pt/types.json') {
        overlay.types = toNameMap(json as NamedCodeEntry[]);
      } else if (filePath === 'translations/pt/subtypes.json') {
        overlay.subtypes = toNameMap(json as NamedCodeEntry[]);
      } else if (filePath.startsWith('translations/pt/pack/') && Array.isArray(json)) {
        forEach(json as ArkhamDbCardTranslationEntry[], cardEntry => {
          if (cardEntry && cardEntry.code) {
            overlay.cards[cardEntry.code] = cardEntry;
          }
        });
      }
    });
  }

  return loadedAnyFile ? overlay : undefined;
}

export interface GqlCardTranslationShape {
  code: string;
  real_name: string;
  errata_date?: string | null;
  taboo_set_id?: number | null;
  duplicate_of_code?: string | null;
  reprint_of_code?: string | null;
  translations: CoreCardTextFragment[];
}

function mergeTranslationFragment<T extends GqlCardTranslationShape>(
  card: T,
  override: ArkhamDbCardTranslationEntry
): T {
  const existing = card.translations.length ? card.translations[0] : undefined;
  const isTabooVariant = card.taboo_set_id !== null && card.taboo_set_id !== undefined && card.taboo_set_id > 0;
  const mergedTranslation: CoreCardTextFragment = {
    ...(existing || { __typename: 'all_card_text', name: card.real_name }),
    name: override.name ?? existing?.name ?? card.real_name,
    subname: override.subname !== undefined ? override.subname : existing?.subname,
    traits: override.traits !== undefined ? override.traits : existing?.traits,
    slot: override.slot !== undefined ? override.slot : existing?.slot,
    flavor: override.flavor !== undefined ? override.flavor : existing?.flavor,
    back_name: override.back_name !== undefined ? override.back_name : existing?.back_name,
    back_subname: override.back_subname !== undefined ? override.back_subname : existing?.back_subname,
    back_traits: override.back_traits !== undefined ? override.back_traits : existing?.back_traits,
    back_flavor: override.back_flavor !== undefined ? override.back_flavor : existing?.back_flavor,
    text: !isTabooVariant && override.text !== undefined ? override.text : existing?.text,
    back_text: !isTabooVariant && override.back_text !== undefined ? override.back_text : existing?.back_text,
    customization_text:
      !isTabooVariant && override.customization_text !== undefined
        ? override.customization_text
        : existing?.customization_text,
    customization_change:
      !isTabooVariant && override.customization_change !== undefined
        ? override.customization_change
        : existing?.customization_change,
    taboo_text_change:
      override.taboo_text_change !== undefined ? override.taboo_text_change : existing?.taboo_text_change,
    taboo_original_text:
      override.taboo_original_text !== undefined ? override.taboo_original_text : existing?.taboo_original_text,
    taboo_original_back_text:
      override.taboo_original_back_text !== undefined
        ? override.taboo_original_back_text
        : existing?.taboo_original_back_text,
  };

  return {
    ...card,
    errata_date: !isTabooVariant && override.errata_date ? override.errata_date : card.errata_date,
    translations: [mergedTranslation],
  };
}

export function applyCardPtOverlay<
  T extends GqlCardTranslationShape & { linked_card?: GqlCardTranslationShape | null }
>(card: T, overlay: ArkhamDbPtOverlay | undefined): T {
  if (!overlay) {
    return card;
  }
  const directOverride = overlay.cards[card.code];
  const fallbackOverride =
    directOverride ||
    (card.duplicate_of_code ? overlay.cards[card.duplicate_of_code] : undefined) ||
    (card.reprint_of_code ? overlay.cards[card.reprint_of_code] : undefined);

  let nextCard: T = fallbackOverride ? mergeTranslationFragment(card, fallbackOverride) : card;
  if (card.linked_card) {
    const linked = card.linked_card;
    const linkedOverride =
      overlay.cards[linked.code] ||
      (linked.duplicate_of_code ? overlay.cards[linked.duplicate_of_code] : undefined) ||
      (linked.reprint_of_code ? overlay.cards[linked.reprint_of_code] : undefined);
    if (linkedOverride) {
      nextCard = {
        ...nextCard,
        linked_card: mergeTranslationFragment(linked, linkedOverride),
      };
    }
  }
  return nextCard;
}
