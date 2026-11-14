"""Render the game's original, deterministic arcade score and feedback cues.

Python 3 and NumPy are needed only to regenerate the committed mono PCM files.
"""
from pathlib import Path
import wave

import numpy as np

RATE = 22050
DESTINATION = Path(__file__).resolve().parents[1] / 'frontend' / 'assets' / '13_audio'


def save(name, samples):
    DESTINATION.mkdir(exist_ok=True)
    samples = np.tanh(samples * 1.32)
    pcm = np.rint(np.clip(samples, -.98, .98) * 32767).astype('<i2')
    with wave.open(str(DESTINATION / f'{name}.wav'), 'wb') as out:
        out.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        out.writeframes(pcm.tobytes())


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def instrument(note, duration, kind):
    t = np.arange(round(RATE * duration)) / RATE
    attack = np.minimum(t / .009, 1)
    release = np.minimum((duration - t) / .045, 1)
    pitch = frequency(note)
    phase = 2 * np.pi * pitch * t
    if kind == 'mallet':
        tone = np.sin(phase) + .26 * np.sin(phase * 2) + .15 * np.sin(phase * 3)
        tone += .21 * np.sin(phase * 4.02) * np.exp(-t * 19)
        envelope = np.exp(-t * 4.6)
    elif kind == 'reed':
        vibrato = .21 * np.sin(2 * np.pi * 5.3 * t) * np.minimum(t / .19, 1)
        tone = .8 * np.sin(phase + vibrato) + .22 * np.sin(2 * phase + vibrato) + .19 * np.sin(3 * phase)
        attack = np.minimum(t / .024, 1)
        envelope = np.exp(-t * 2.1)
    elif kind == 'pluck':
        tone = np.sin(phase) + .22 * np.sin(phase * 2) + .15 * np.sin(phase * 4) * np.exp(-t * 17)
        envelope = np.exp(-t * 8.4)
    elif kind == 'pad':
        tone = .44 * (np.sin(phase * .997) + np.sin(phase * 1.003)) + .18 * np.sin(phase * 2)
        attack = np.minimum(t / .11, 1)
        release = np.minimum((duration - t) / .21, 1)
        envelope = 1 - np.minimum(t / duration, 1) * .26
    elif kind == 'bell':
        tone = np.sin(phase) + .27 * np.sin(phase * 2.02) + .12 * np.sin(phase * 3.96)
        envelope = np.exp(-t * 7)
    elif kind == 'bass':
        tone = np.sin(phase) + .24 * np.sin(phase * 2) + .08 * np.sin(phase * 3)
        envelope = np.exp(-t * 8.2)
    else:
        tone = .48 * np.sin(phase) + .23 * np.sin(phase * 2) + .1 * np.sin(phase * 3)
        envelope = np.exp(-t * 9)
    return tone * envelope * attack * release


def score(name, tempo, chords, melody, match=False):
    beat = 60 / tempo
    length = round(len(chords) * 4 * beat * RATE)
    output = np.zeros(length)
    rng = np.random.default_rng(31)

    def mix(at, audio, gain):
        index = round(RATE * beat * at)
        indexes = (np.arange(len(audio)) + index) % length
        output[indexes] += audio * gain

    def note(at, pitch, duration, kind, gain):
        mix(at, instrument(pitch, duration * beat, kind), gain)

    def drum(at, kind, gain):
        t = np.arange(round(RATE * .14)) / RATE
        noise = rng.normal(0, 1, len(t))
        if kind == 'kick':
            phase = 2 * np.pi * (49 * t + 46 * (1 - np.exp(-t * 49)) / 49)
            sound = np.sin(phase) * np.exp(-t * 29)
        elif kind == 'hat':
            sound = np.r_[0, np.diff(noise)] * np.exp(-t * 101) * .36
        else:
            sound = (.21 * noise + .38 * np.sin(2 * np.pi * 180 * t) + .12 * np.sin(2 * np.pi * 240 * t)) * np.exp(-t * 43)
        mix(at, sound * np.minimum(t / .002, 1), gain)

    for bar, (bass, tones) in enumerate(chords):
        base = bar * 4
        chorus = 4 <= bar < 8 or 12 <= bar
        bridge = 8 <= bar < 12
        swing = .068 if match else .12
        bassline = [(0, bass), (1.5 + swing, bass + 12), (2, bass + 7), (3.5 + swing, bass + 12)]
        if bridge:
            bassline = [(0, bass), (2.5 + swing, bass + 7)]
        for at, pitch in bassline:
            note(base + at, pitch, .75 if bridge else .57, 'bass', .13 if match else .113)
        for offset, pitch in zip((.5, 1.5, 2.5, 3.5), (*tones, tones[1])):
            note(base + offset + swing, pitch + (12 if bridge else 0), .57, 'pluck', .052)
        for pitch in tones:
            note(base, pitch, 4.08, 'pad', .025 if chorus else .018)
        for slot, pitch in enumerate(melody[bar]):
            if not pitch:
                continue
            at = base + slot / 2 + swing * (slot % 2)
            sustain = slot == 7 or not melody[bar][slot + 1]
            voice = 'reed' if (bridge or chorus and sustain) else 'mallet'
            note(at, pitch, .82 if sustain else .51, voice, .14 if slot % 2 == 0 else .105)
            note(at + .385, pitch, .58, 'mallet', .021)
            if chorus and slot in (0, 4, 7):
                note(at, pitch + 12, .67, 'bell', .035)
        for at in ((0, 1.75, 2.5) if match and not bridge else (0, 2)):
            drum(base + at, 'kick', .108 if match else .076)
        for at in (1, 3):
            drum(base + at, 'snare', .07 if chorus else .052)
        for step in range(4 if bridge else 8):
            spacing = 1 if bridge else .5
            drum(base + step * spacing + swing * (step % 2), 'hat', .018 + .012 * (step % 2))
        if bar % 4 in (1, 3):
            note(base + 2.76, tones[1] + 12, .40, 'bell', .035)
            note(base + 3.30, tones[-1] + 12, .68, 'bell', .049)
    save(name, output)


LOBBY_CHORDS = [
    (48, [60, 64, 67]), (45, [60, 64, 69]), (41, [60, 65, 69]), (43, [59, 62, 67]),
    (48, [60, 64, 67]), (40, [59, 64, 67]), (41, [60, 65, 69]), (43, [59, 62, 67]),
    (45, [60, 64, 69]), (40, [59, 64, 67]), (41, [60, 65, 69]), (48, [60, 64, 67]),
    (50, [60, 62, 65]), (41, [60, 65, 69]), (43, [59, 62, 67]), (48, [60, 64, 67]),
]
LOBBY_TUNE = [
    [72,0,76,79,0,76,74,72], [69,72,76,0,81,79,76,0], [77,0,76,72,69,72,77,0], [74,71,67,0,74,77,79,0],
    [84,0,79,76,72,0,76,79], [83,79,76,0,71,74,76,0], [81,0,77,72,69,72,77,76], [74,0,71,74,79,77,74,0],
    [69,0,72,0,76,0,79,0], [76,0,71,0,67,0,71,0], [72,0,77,0,81,0,77,0], [76,0,79,0,84,0,79,0],
    [74,77,81,0,77,74,72,0], [69,72,77,0,81,77,76,0], [74,0,79,77,74,71,67,0], [72,0,76,79,84,0,79,0],
]
MATCH_CHORDS = [
    (43,[59,62,67]), (43,[59,62,67]), (40,[59,64,67]), (40,[59,64,67]),
    (48,[60,64,67]), (48,[60,64,67]), (50,[60,62,66]), (50,[60,62,66]),
    (43,[59,62,67]), (47,[59,62,66]), (48,[60,64,67]), (50,[60,62,66]),
    (40,[59,64,67]), (45,[60,64,69]), (48,[60,64,67]), (50,[60,62,66]),
]
MATCH_TUNE = [
    [79,74,76,79,83,0,79,76],[74,0,71,74,79,81,83,0],[76,79,83,79,76,74,71,0],[76,0,79,83,86,83,79,0],
    [84,79,76,79,84,0,86,84],[79,76,72,76,79,0,84,0],[86,81,78,81,86,84,81,78],[74,78,81,0,86,84,81,0],
    [74,0,79,0,83,0,79,0],[78,0,74,0,83,0,74,0],[76,0,79,0,84,0,79,0],[78,0,74,0,81,0,78,0],
    [76,79,83,0,86,83,79,76],[81,84,88,0,84,81,79,76],[84,79,76,79,84,86,84,81],[78,0,81,78,74,76,78,0],
]


def chirp(duration, start, end, gain=1):
    t = np.arange(round(RATE * duration)) / RATE
    phase = 2 * np.pi * (start * t + (end - start) * t * t / (2 * duration))
    env = np.minimum(t / .007, 1) * np.minimum((duration - t) / .03, 1) * np.exp(-.6 * t / duration)
    return gain * env * (np.sin(phase) + .21 * np.sin(phase * 2))


def cue(name, duration, parts, splash=0):
    out = np.zeros(round(RATE * duration))
    for at, length, start, end, gain in parts:
        begin = round(at * RATE)
        samples = chirp(length, start, end, gain)
        out[begin:begin + len(samples)] += samples
    if splash:
        noise = np.random.default_rng(123).normal(0, 1, len(out))
        filtered = np.convolve(noise, np.ones(6) / 6, mode='same')
        time = np.arange(len(out)) / RATE
        out += filtered * splash * np.exp(-time * 19) * np.minimum(time / .005, 1)
    save(name, out)


def jingle(name, notes):
    output = np.zeros(round(RATE * 1.45))
    for at, pitch, voice, gain in notes:
        start = round(at * RATE)
        sound = instrument(pitch, .46, voice)
        output[start:start + len(sound)] += gain * sound
    save(name, output)


if __name__ == '__main__':
    score('breezy_plaza', 110, LOBBY_CHORDS, LOBBY_TUNE)
    score('splash_rally', 134, MATCH_CHORDS, MATCH_TUNE, match=True)
    cue('place', .19, [(0,.12,860,316,.38),(.054,.13,590,975,.19)])
    cue('throw', .29, [(0,.19,410,1190,.29),(.12,.15,940,410,.25)], .09)
    cue('splash', .35, [(0,.17,280,97,.29),(.041,.118,910,447,.16),(.152,.15,776,503,.13)], .55)
    cue('prize', .31, [(0,.12,740,905,.23),(.069,.13,997,1203,.24),(.15,.15,1480,1290,.20)])
    cue('bubble', .42, [(0,.18,580,1040,.22),(.09,.14,790,479,.26),(.235,.177,430,785,.19)], .05)
    cue('rescue', .37, [(0,.14,540,715,.25),(.095,.15,820,1060,.26),(.21,.15,1140,1510,.17)])
    cue('pop', .24, [(0,.15,842,225,.33),(.05,.175,390,235,.15)], .18)
    cue('go', .34, [(0,.14,685,900,.25),(.105,.218,1020,1430,.23)])
    cue('step', .09, [(0,.079,248,139,.22)], .055)
    cue('cheer', .48, [(0,.145,565,960,.21),(.10,.17,800,1120,.23),(.23,.23,1240,1360,.19)])
    cue('kick', .23, [(0,.10,342,142,.34),(.04,.178,560,340,.21)], .12)
    jingle('win', [(0,72,'mallet',.25),(.12,76,'mallet',.22),(.24,79,'mallet',.22),(.36,84,'bell',.24),
                   (.52,79,'reed',.15),(.59,84,'reed',.14),(.62,76,'bell',.19),(.75,88,'bell',.15),(.92,84,'bell',.12)])
    jingle('loss', [(0,77,'mallet',.21),(.15,76,'mallet',.18),(.32,72,'reed',.14),(.48,69,'mallet',.15),
                    (.64,65,'bell',.14),(.77,72,'bell',.14),(.91,77,'bell',.11)])
