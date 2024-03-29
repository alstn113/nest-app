import { Injectable } from '@nestjs/common';
import { Comment, CommentLike, Prisma } from '@prisma/client';
import { AppErrorException } from 'src/common/exception/error.exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  async findComments({ slug, userId = null }: GetCommentsParams) {
    const post = await this.prisma.post.findUnique({
      where: {
        slug,
      },
    });
    if (!post) throw new AppErrorException('NotFound');
    const comments = await this.prisma.comment.findMany({
      where: {
        postId: post.id,
      },
      orderBy: [{ createdAt: 'asc' }, { level: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    const commetLikedMap = userId
      ? await this.getCommentLikeMap({
          commentIds: comments.map((comment) => comment.id),
          userId,
        })
      : null;

    const commentsWithLiked = comments.map((comment) =>
      this.mergeCommentLikeMap(comment, commetLikedMap?.[comment.id]),
    );

    const filteredComments = this.hideDeletedComments(commentsWithLiked);
    const groupedComments = this.groupSubComments(filteredComments);

    return groupedComments;
  }

  async findComment(commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });
    if (!comment || comment.deletedAt) {
      throw new AppErrorException('NotFound');
    }
    return comment;
  }

  hideDeletedComments(comments: Comment[]) {
    return comments.map((comment) => {
      if (!comment.deletedAt) return { ...comment, isDeleted: false };
      const someDate = new Date(0);
      return {
        ...comment,
        text: '',
        likes: 0,
        userId: null,
        user: { id: null, username: null },
        createdAt: someDate,
        updatedAt: someDate,
        isDeleted: true,
      };
    });
  }

  groupSubComments(comments: Comment[]) {
    const rootComments = comments.filter(
      (comment) => comment.parentCommentId === null,
    );
    const subCommentsMap = new Map<string, Comment[]>();

    comments.forEach((comment) => {
      if (!comment.parentCommentId) return;
      const subComments = subCommentsMap.get(comment.parentCommentId) ?? [];
      subComments.push(comment);
      subCommentsMap.set(comment.parentCommentId, subComments);
    });

    const groupedComments = rootComments.map((rootComment) => ({
      ...rootComment,
      subComments: subCommentsMap.get(rootComment.id) ?? [],
    }));

    return groupedComments;
  }

  async createComment(
    userId: string,
    { text, postId, parentCommentId }: CreateCommentDto,
  ) {
    const parentComment = parentCommentId
      ? await this.findComment(parentCommentId)
      : null;

    const comment: Prisma.XOR<
      Prisma.CommentCreateInput,
      Prisma.CommentUncheckedCreateInput
    > = {
      text,
      userId,
      postId,
      parentCommentId: parentComment?.id,
    };

    if (parentComment) {
      comment.level = parentComment.level + 1;
      // 댓글과 대댓글까지만 가능
      if (comment.level >= 2) {
        throw new AppErrorException('BadRequest');
      }
    }

    const createComment = await this.prisma.comment.create({
      data: comment,
    });

    if (parentComment) {
      const subCommentsCount = await this.prisma.comment.count({
        where: {
          parentCommentId: parentComment.id,
        },
      });

      await this.prisma.comment.update({
        data: {
          subCommentsCount,
        },
        where: {
          id: parentComment.id,
        },
      });
    }

    await this.updatePostCommentsCount(postId);
    return createComment;
  }

  async updatePostCommentsCount(postId: string) {
    const commentsCount = await this.prisma.comment.count({
      where: {
        postId,
      },
    });
    await this.prisma.postStats.update({
      data: { commentsCount },
      where: {
        postId,
      },
    });

    return commentsCount;
  }

  async updateCommentLikes(commentId: string) {
    const commentLikes = await this.prisma.commentLike.count({
      where: {
        commentId,
      },
    });
    await this.prisma.comment.update({
      data: { likes: commentLikes },
      where: { id: commentId },
    });

    return commentLikes;
  }

  async deleteComment({ userId, commentId }: CommentActionParams) {
    const comment = await this.findComment(commentId);
    if (comment.userId !== userId) throw new AppErrorException('Unauthorized');

    const deletedComment = await this.prisma.comment.update({
      data: {
        deletedAt: new Date(),
      },
      where: {
        id: commentId,
      },
    });

    return deletedComment;
  }

  async likeComment({ userId, commentId }: CommentActionParams) {
    const alreadyLiked = await this.prisma.commentLike.findUnique({
      where: {
        commentId_userId: { commentId, userId },
      },
    });
    if (!alreadyLiked) {
      await this.prisma.commentLike.create({ data: { commentId, userId } });
    }

    const commentLikes = await this.updateCommentLikes(commentId);
    return commentLikes;
  }

  async unlikeComment({ userId, commentId }: CommentActionParams) {
    const alreadyLiked = await this.prisma.commentLike.findUnique({
      where: {
        commentId_userId: { commentId, userId },
      },
    });
    if (alreadyLiked) {
      await this.prisma.commentLike.delete({
        where: { commentId_userId: { commentId, userId } },
      });
    }

    const commentLikes = await this.updateCommentLikes(commentId);
    return commentLikes;
  }

  private async getCommentLikeMap({
    commentIds,
    userId,
  }: GetCommentLikedParams) {
    const list = await this.prisma.commentLike.findMany({
      where: {
        commentId: { in: commentIds },
        userId,
      },
    });
    return list.reduce((acc, cur) => {
      acc[cur.commentId] = cur;
      return acc;
    }, {} as Record<string, CommentLike>);
  }

  private mergeCommentLikeMap(comment: Comment, commentLike?: CommentLike) {
    return {
      ...comment,
      isLiked: !!commentLike,
    };
  }
}

interface GetCommentsParams {
  slug: string;
  userId?: string | null;
}

interface CommentActionParams {
  userId: string;
  commentId: string;
}

interface GetCommentLikedParams {
  userId: string;
  commentIds: string[];
}
