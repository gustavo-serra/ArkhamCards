import React, { useCallback, useContext, useMemo, useState } from 'react';
import { t } from 'ttag';
import { ThunkDispatch } from 'redux-thunk';
import { Action } from 'redux';
import { useDispatch, useSelector } from 'react-redux';

import { disassembleCampaignDecks } from '@actions';
import { CampaignId } from '@actions/types';
import { ShowAlert } from '@components/deck/dialogs';
import ArkhamCardsAuthContext from '@lib/ArkhamCardsAuthContext';
import { UpdateCampaignActions, useDeleteCampaignRequest, useLeaveCampaignRequest } from '@data/remote/campaigns';
import { deleteCampaign, updateCampaignArchived } from './actions';
import { s } from '@styles/space';
import DeckButton from '@components/deck/controls/DeckButton';
import SingleCampaignT from '@data/interfaces/SingleCampaignT';
import { AppState } from '@reducers';
import { useNavigation } from '@react-navigation/native';

interface Props {
  campaignId: CampaignId;
  campaign: SingleCampaignT | undefined;
  actions: UpdateCampaignActions;
  showAlert: ShowAlert;
  standalone?: boolean;
}

type Dispatch = ThunkDispatch<AppState, unknown, Action<string>>;

function archiveButtonText(archived: boolean, standalone?: boolean): string {
  if (standalone) {
    return archived ? t`Unarchive standalone` : t`Archive standalone`;
  }
  return archived ? t`Unarchive campaign` : t`Archive campaign`;
}

export default function DeleteCampaignButton({ actions, campaignId, campaign, showAlert, standalone }: Props) {
  const navigation = useNavigation();
  const { userId } = useContext(ArkhamCardsAuthContext);
  const dispatch: Dispatch = useDispatch();
  const rawLocalCampaign = useSelector((state: AppState) => state.campaigns_2.all[campaignId.campaignId]);
  const deleteServerCampaign = useDeleteCampaignRequest();
  const leaveCampaign = useLeaveCampaignRequest();
  const disassembleAllLinkedCampaignDecks = useCallback(() => {
    dispatch(disassembleCampaignDecks(campaignId));
    if (campaign?.linkedCampaignId) {
      dispatch(disassembleCampaignDecks(campaign.linkedCampaignId));
    }
    if (rawLocalCampaign?.linkedCampaignUuid) {
      dispatch(disassembleCampaignDecks({ campaignId: rawLocalCampaign.linkedCampaignUuid }));
    }
    if (rawLocalCampaign?.linkUuid) {
      dispatch(disassembleCampaignDecks({ campaignId: rawLocalCampaign.linkUuid.campaignIdA }));
      dispatch(disassembleCampaignDecks({ campaignId: rawLocalCampaign.linkUuid.campaignIdB }));
    }
  }, [dispatch, campaignId, campaign?.linkedCampaignId, rawLocalCampaign]);

  const actuallyDeleteCampaign = useCallback(() => {
    disassembleAllLinkedCampaignDecks();
    if (campaignId.serverId && userId) {
      deleteServerCampaign(campaignId);
    }
    dispatch(deleteCampaign(userId, campaignId));
    navigation.goBack();
  }, [navigation, dispatch, campaignId, deleteServerCampaign, userId, disassembleAllLinkedCampaignDecks]);
  const confirmDeleteCampaign = useCallback(() => {
    const campaignName = campaign?.name || '';
    showAlert(
      t`Delete`,
      standalone ?
        t`Are you sure you want to delete this standalone?` :
        t`Are you sure you want to delete the campaign: ${campaignName}`,
      [
        { text: t`Cancel`, style: 'cancel' },
        { text: t`Delete`, onPress: actuallyDeleteCampaign, style: 'destructive' },
      ],
    );
  }, [campaign, actuallyDeleteCampaign, showAlert, standalone]);

  const actuallyLeaveCampaign = useCallback(() => {
    disassembleAllLinkedCampaignDecks();
    if (campaignId.serverId) {
      leaveCampaign(campaignId);
    }
    navigation.goBack();
  }, [campaignId, navigation, leaveCampaign, disassembleAllLinkedCampaignDecks]);
  const confirmLeaveCampaign = useCallback(() => {
    showAlert(
      standalone ? t`Leave standalone` : t`Leave campaign`,
      standalone ?
        t`Are you sure you want to leave this standalone?\n\nYour decks will be removed from the standalone, but you can rejoin it later.` :
        t`Are you sure you want to leave this campaign?\n\nYour decks will be removed from the campaign, but you can rejoin it later.`,
      [
        { text: t`Cancel`, style: 'cancel' },
        { text: t`Leave`, onPress: actuallyLeaveCampaign, style: 'destructive' },
      ],
    );
  }, [standalone, actuallyLeaveCampaign, showAlert]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const archiveCampaign = useCallback(async() => {
    const nextArchived = !campaign?.archived;
    setArchiveLoading(true);
    await dispatch(updateCampaignArchived(userId, actions, campaignId, nextArchived));
    if (nextArchived) {
      disassembleAllLinkedCampaignDecks();
    }
    setArchiveLoading(false);
  }, [dispatch, setArchiveLoading, campaignId, actions, userId, campaign?.archived, disassembleAllLinkedCampaignDecks]);
  const archiveButton = useMemo(() => {
    const archived = !!campaign?.archived;
    return (
      <DeckButton
        icon="book"
        title={archiveButtonText(archived, standalone)}
        thin
        loading={archiveLoading}
        color="light_gray"
        onPress={archiveCampaign}
        bottomMargin={s}
      />
    );
  }, [archiveCampaign, campaign?.archived, standalone, archiveLoading]);
  const deleteButton = useMemo(() => {
    if (userId && campaignId.serverId && campaign && userId !== campaign.owner_id) {
      return (
        <DeckButton
          icon="trash"
          title={standalone ? t`Leave standalone` : t`Leave campaign`}
          thin
          color="red_outline"
          onPress={confirmLeaveCampaign}
          bottomMargin={s}
        />
      );
    }
    return (
      <DeckButton
        icon="trash"
        title={standalone ? t`Delete standalone` : t`Delete campaign`}
        thin
        color="red_outline"
        onPress={confirmDeleteCampaign}
        bottomMargin={s}
      />
    );
  }, [userId, campaignId.serverId, campaign, standalone, confirmLeaveCampaign, confirmDeleteCampaign]);
  return (
    <>
      {archiveButton}
      {deleteButton}
    </>
  );
}
