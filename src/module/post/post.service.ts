import { Injectable } from '@nestjs/common';
import { Post, PostLike, PostStats } from '@prisma/client';
import { AppErrorException } from 'src/common/exception/error.exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { generateId, slugify } from 'src/utils/slugify';
import { CreatePostDto } from './dto/create-post.dto';
import { FindPostQueryDto } from './dto/find-post-query.dto';

@Injectable()
export class PostService {
  constructor(private readonly prisma: PrismaService) {}

  async findPostById(postId: string) {
    const post = await this.prisma.post.findUnique({
      where: {
        id: postId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        postStats: true,
      },
    });
    if (!post) throw new AppErrorException('NotFound');
    return post;
  }

  async findPostsByQuries({
    cursor,
    userId,
  }: FindPostQueryDto & { userId?: string }) {
    const size = 20;
    const posts = await this.prisma.post.findMany({
      take: size,
      skip: 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        postStats: true,
      },
    });

    const postLikedMap = userId
      ? await this.getPostLikedMap({
          postIds: posts.map((post) => post.id),
          userId,
        })
      : null;
    const postsWithLiked = posts.map((post) =>
      this.mergePostLiked(post, postLikedMap?.[post.id]),
    );

    const nextCursor = postsWithLiked[size - 1]?.id;

    return { posts: postsWithLiked, nextCursor };
  }

  async searchPosts(keyword: string) {
    return await this.prisma.post.findMany({
      where: {
        OR: [
          {
            title: {
              contains: keyword,
            },
          },
          {
            body: {
              contains: keyword,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        postStats: true,
      },
    });
  }

  async findPostBySlug(slug: string, userId?: string) {
    const post = await this.prisma.post.findUnique({
      where: {
        slug,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        postStats: true,
      },
    });
    if (!post) throw new AppErrorException('NotFound');

    const postLikedMap = userId
      ? await this.getPostLikedMap({ postIds: [post.id], userId })
      : null;
    return this.mergePostLiked(post, postLikedMap?.[post.id]);
  }

  async createPost(userId: string, { title, body }: CreatePostDto) {
    let slug = slugify(title);
    const isSameSlugExists = await this.prisma.post.findUnique({
      where: { slug },
    });
    if (isSameSlugExists) {
      slug += `-${generateId()}`;
    }
    const post = await this.prisma.post.create({
      data: { title, body, userId, slug },
    });

    await this.prisma.postStats.create({
      data: {
        postId: post.id,
      },
    });

    return post;
  }

  async updatePostLikes(postId: string): Promise<PostStats> {
    const likes = await this.prisma.postLike.count({
      where: {
        postId,
      },
    });

    const postStats = await this.prisma.postStats.update({
      data: {
        likes,
      },
      where: {
        postId,
      },
    });

    return postStats;
  }

  async likePost({ userId, postId }: PostActionParams): Promise<PostStats> {
    const alreadyLiked = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!alreadyLiked) {
      await this.prisma.postLike.create({ data: { postId, userId } });
    }
    const postStats = await this.updatePostLikes(postId);
    return postStats;
  }

  async unlikePost({ userId, postId }: PostActionParams): Promise<PostStats> {
    const alreadyLiked = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (alreadyLiked) {
      await this.prisma.postLike.delete({
        where: { postId_userId: { postId, userId } },
      });
    }

    const postStats = await this.updatePostLikes(postId);

    return postStats;
  }

  async deletePost({ userId, postId }: PostActionParams) {
    const post = await this.findPostById(postId);
    if (post.userId !== userId) throw new AppErrorException('Unauthorized');
    return await this.prisma.post.delete({
      where: {
        id: postId,
      },
    });
  }

  private async getPostLikedMap({ postIds, userId }: GetPostLikedParams) {
    const list = await this.prisma.postLike.findMany({
      where: {
        postId: {
          in: postIds,
        },
        userId,
      },
    });
    return list.reduce((acc, cur) => {
      acc[cur.postId] = cur;
      return acc;
    }, {} as Record<string, PostLike>);
  }

  private mergePostLiked(post: Post, postLike?: PostLike) {
    return {
      ...post,
      isLiked: !!postLike,
    };
  }
}

interface PostActionParams {
  userId: string;
  postId: string;
}

interface GetPostLikedParams {
  userId: string;
  postIds: string[];
}
