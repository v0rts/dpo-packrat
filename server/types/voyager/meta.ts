/* eslint-disable quotes, @typescript-eslint/brace-style, @typescript-eslint/no-explicit-any */
/**
 * NOTE: this file is part of the definition of a Voyager scene, found in a .svx.json file.
 * This was imported from Voyager's source/client/schema on 4/2/2025. It was then modified,
 * minimally, to allow for use by Packrat. Ideally, in the future, we will extract out the
 * definition of this shared file format for use by both projects.
 */
/**
 * 3D Foundation Project
 * Copyright 2019 Smithsonian Institution
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// import { Index, Dictionary } from "@ff/core/types";
type Index = number;
type Dictionary<T> = Record<string, T>;

////////////////////////////////////////////////////////////////////////////////

/**
 * Contains meta data (articles, collection record, processing information)
 * about a scene item (scene root, model).
 */
export interface IMeta
{
    collection?: Dictionary<any>;
    process?: Dictionary<any>;
    images?: IImage[];
    articles?: IArticle[];
    audio?: IAudioClip[];
    leadArticle?: Index;
}

export interface IImage
{
    quality: TImageQuality,
    uri: string;
    byteSize: number;
    width: number;
    height: number;
    usage?: TImageUsage;
}

export type TImageQuality = "Thumb" | "Low" | "Medium" | "High";
export type TImageUsage = "Render" | "ARCode";

/**
 * Refers to an external document or a media file (audio, video, image).
 */
export interface IArticle
{
    id: string;
    uri: string;
    uris?: Dictionary<string>;

    title?: string;
    titles?: Dictionary<string>;
    lead?: string;
    leads?: Dictionary<string>;
    tags?: string[];
    taglist?: Dictionary<string[]>;
    intros?: Dictionary<string[]>;

    mimeType?: string;
    thumbnailUri?: string;
}

/**
 * Notes taken during processing. Part of the process section of [[IMeta]].
 */
export interface INote
{
    date: string;
    user: string;
    text: string;
}

/**
 * Audio files referenced by the scene [narrations, audio descriptions, etc.].
 */
export interface IAudioClip
{
    id: string;
    name: string;
    uris: Dictionary<string>;
    captionUris: Dictionary<string>;
    durations: Dictionary<string>;
}