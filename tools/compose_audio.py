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
    if kind == 'lead':
        # Marimba body with a soft, rapidly decaying mallet overtone.
        tone = np.sin(phase) + .29 * np.sin(phase * 2) + .16 * np.sin(phase * 3)
        tone += .14 * np.sin(phase * 3.98) * np.exp(-t * 28)
        envelope = np.exp(-t * 5.8)
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


def score(name, tempo, chords, melody, busy=False):
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
            sound = (.45 * noise + .37 * np.sin(2 * np.pi * 180 * t)) * np.exp(-t * 55)
        mix(at, sound * np.minimum(t / .002, 1), gain)

    for bar, (bass, tones) in enumerate(chords):
        base = bar * 4
        for at, pitch in [(0, bass), (1.5, bass + 12), (2, bass + 7), (3.5, bass + 12)]:
            note(base + at, pitch, .51, 'bass', .118 if busy else .1)
        for at in ((.5, 1.5, 2.5, 3.5) if busy else (.5, 2.5)):
            for pitch in tones:
                note(base + at, pitch, .7, 'chord', .045)
        for slot, pitch in enumerate(melody[bar]):
            if pitch:
                note(base + slot / 2, pitch, .60, 'lead', .169 if slot % 2 == 0 else .139)
                if slot in (0, 4, 7):
                    note(base + slot / 2, pitch + 12, .58, 'bell', .049)
        for at in (0, 2) if not busy else (0, 1.75, 2.5):
            drum(base + at, 'kick', .11)
        for at in (1, 3):
            drum(base + at, 'snare', .08)
        for step in range(8):
            drum(base + step / 2, 'hat', .028 + .017 * (step % 2))
        if bar % 4 in (1, 3):
            note(base + 3.25, tones[-1] + 12, .53, 'bell', .041)
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
    [76,81,0,84,81,0,79,76], [71,76,0,79,76,74,71,0], [72,77,0,81,84,81,77,0], [76,79,84,0,79,76,72,0],
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
    [79,83,86,0,83,79,76,79],[78,83,86,0,90,86,83,0],[84,0,81,79,76,72,76,79],[81,86,84,81,78,74,78,0],
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


if __name__ == '__main__':
    score('lobby_parade', 113, LOBBY_CHORDS, LOBBY_TUNE)
    score('balloon_rally', 143, MATCH_CHORDS, MATCH_TUNE, busy=True)
    cue('place', .19, [(0,.12,860,316,.38),(.054,.13,590,975,.19)])
    cue('throw', .29, [(0,.19,410,1190,.29),(.12,.15,940,410,.25)], .09)
    cue('splash', .35, [(0,.17,280,97,.29),(.041,.118,910,447,.16),(.152,.15,776,503,.13)], .55)
    cue('prize', .31, [(0,.12,740,905,.23),(.069,.13,997,1203,.24),(.15,.15,1480,1290,.20)])
    cue('bubble', .42, [(0,.18,580,1040,.22),(.09,.14,790,479,.26),(.235,.177,430,785,.19)], .05)
    cue('rescue', .37, [(0,.14,540,715,.25),(.095,.15,820,1060,.26),(.21,.15,1140,1510,.17)])
    cue('pop', .24, [(0,.15,842,225,.33),(.05,.175,390,235,.15)], .18)
    cue('go', .34, [(0,.14,685,900,.25),(.105,.218,1020,1430,.23)])
    cue('step', .09, [(0,.079,248,139,.22)], .055)
