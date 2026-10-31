import type { CommentActions, ComposerActions, FeedActions, MineActions, PostActions, ProfileActions, RailActions } from "@/lib/junction/types";
import {
  acceptRulesAction,
  addInterestFromRail,
  appealAction,
  commentAction,
  createPostAction,
  deleteCommentAction,
  deletePostAction,
  editPostAction,
  moreFeedAction,
  moreMineAction,
  pinAction,
  removeInterestFromRail,
  reportAction,
  reshareAction,
  saveAction,
  showJunctionPostsAction,
  voteCommentAction,
  votePostAction,
} from "./actions";

/* The server actions grouped as Junction's client components take them (src/lib/junction/types.ts). Server only. */

export const postActions: PostActions = {
  vote: votePostAction,
  reshare: reshareAction,
  save: saveAction,
  edit: editPostAction,
  remove: deletePostAction,
  pin: pinAction,
  report: reportAction,
};

export const commentActions: CommentActions = { add: commentAction, vote: voteCommentAction, remove: deleteCommentAction, report: reportAction };
export const composerActions: ComposerActions = { create: createPostAction, acceptRules: acceptRulesAction };
export const feedActions: FeedActions = { more: moreFeedAction };
export const mineActions: MineActions = { more: moreMineAction, appeal: appealAction };
export const railActions: RailActions = { addInterest: addInterestFromRail, removeInterest: removeInterestFromRail };
export const profileActions: ProfileActions = { showPosts: showJunctionPostsAction };
