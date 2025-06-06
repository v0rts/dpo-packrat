/* eslint-disable quotes, @typescript-eslint/brace-style, @typescript-eslint/no-explicit-any */
/**
 * NOTE: this file is part of the definition of a Voyager scene, found in a .svx.json file.
 * This was imported from Voyager's source/client/schema on 4/2/2025. It was then modified,
 * minimally, to allow for use by Packrat. Ideally, in the future, we will extract out the
 * definition of this shared file format for use by both projects.
 */
//import { Dictionary } from "@ff/core/types";
type Dictionary<T> = Record<string, T>;
import { ELanguageType, TLanguageType } from "./common";

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

export type TShaderMode = "Default" | "Clay" | "XRay" | "Normals" | "Wireframe";
export enum EShaderMode { Default, Clay, XRay, Normals, Wireframe }

export type TBackgroundStyle = "Solid" | "LinearGradient" | "RadialGradient";
export enum EBackgroundStyle { Solid, LinearGradient, RadialGradient }

export type TNavigationType = "Orbit" | "Fly" | "Walk";
export enum ENavigationType { Orbit, Fly, Walk }

export type TReaderPosition = "Overlay" | "Left" | "Right";
export enum EReaderPosition { Overlay, Left, Right }

export type TSliceAxis = "X" | "Y" | "Z";
export enum ESliceAxis { X, Y, Z }

export interface ISetup
{
    interface?: IInterface;
    viewer?: IViewer;
    reader?: IReader;
    navigation?: INavigation;
    background?: IBackground;
    environment?: IEnvironment,
    language?: ILanguage,
    floor?: IFloor;
    grid?: IGrid;
    tape?: ITape;
    slicer?: ISlicer;
    tours?: ITours;
    snapshots?: ISnapshots;
    audio?: IAudio;
}

export interface IInterface
{
    visible: boolean;
    logo: boolean;
    menu: boolean;
    tools: boolean;
}

export interface IViewer
{
    shader: TShaderMode;
    exposure: number;
    toneMapping: boolean;
    gamma: number;
    isWallMountAR: boolean;
    arScale: number;
    annotationsVisible?: boolean;
    activeTags?: string;
    sortedTags?: string;
    radioTags?: boolean;
}

export interface IReader
{
    enabled: boolean;
    position: string;
    articleId?: string;
}

export interface INavigation
{
    type: TNavigationType;
    enabled: boolean;
    autoZoom: boolean;
    autoRotation: boolean;
    lightsFollowCamera: boolean;
    orbit?: IOrbitNavigation;
    walk?: IWalkNavigation;
}

export interface IOrbitNavigation
{
    orbit: number[];
    offset: number[];
    minOrbit: number[];
    maxOrbit: number[];
    minOffset: number[];
    maxOffset: number[];
}

export interface IWalkNavigation
{
    position: number[];
    rotation: number[];
    minPosition: number[];
    maxPosition: number[];
}

export interface IBackground
{
    style: TBackgroundStyle;
    color0: number[];
    color1: number[];
}

export interface IFloor
{
    visible: boolean;
    position: number[];
    size: number;
    color: number[];
    opacity: number;
    receiveShadow: boolean;
    autoSize: boolean;
}

export interface IGrid
{
    visible: boolean;
    color: number[];
}

export interface IEnvironment
{
    index: number;
}

export interface ILanguage
{
    language: TLanguageType;
}

export interface IAudio
{
    narrationId?: string;
}

export interface ITape
{
    enabled: boolean;
    startPosition?: number[];
    startDirection?: number[];
    endPosition?: number[];
    endDirection?: number[];
}

export interface ISlicer
{
    enabled: boolean;
    axis: TSliceAxis;
    inverted: boolean;
    position: number;
    color: number[];
}

export type ITours = ITour[];

export interface ISnapshots
{
    features: string[];
    targets: string[];
    states: {
        id: string;
        curve: string;
        duration: number;
        threshold: number;
        values: any[];
    }[];
}

export interface ITour
{
    title: string;
    titles?: Dictionary<string>;
    steps: ITourStep[];
    lead?: string;
    leads?: Dictionary<string>;
    tags?: string[];
    taglist?: Dictionary<string[]>;
}

export interface ITourStep
{
    title: string;
    titles?: Dictionary<string>;
    altTexts?: Dictionary<string>;
    id: string;
}

export interface ILanguageOption
{
    name: string;
    id: ELanguageType;
}