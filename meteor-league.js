import { league_api_key } from './config.js';

Champions = new Mongo.Collection('champions');
ChampionsUpdated = new Mongo.Collection('championsUpdated');
Masteries = new Mongo.Collection(null);

if (Meteor.isClient) {
  Session.setDefault('loading', false);
  Session.setDefault('masteryOrder', 1);

  Meteor.subscribe('champions');

  Template.body.helpers({
    hasChampions: _ =>  Masteries.find({}).count() > 0,
    lowestChampions: function() {
      var order = Session.get('masteryOrder');
      var masteries = Masteries.find({}, {sort: { championPoints: order }}).fetch();

      var champs = [], roles = [];
      for (var i in masteries) {
        var role = masteries[i].champInfo.tags[0];
        if(!roles.includes(role)) {
          champs.push(masteries[i]);
          roles.push(role);
        }

        if(champs.length == 6) {
          break;
        }
      }

      return champs;
    }
  });

  Template.search.helpers({
    loading: function () {
      return Session.get('loading');
    }
  });

  Template.search.rendered = function() {
    var headerDropdown = $('.search-header .ui.dropdown');
    headerDropdown.dropdown({
      'set selected': 1,
      onChange: function(value, text) {
        Session.set('masteryOrder', value);
      }
    });
  };

  Template.body.rendered = function() {
    $('.message .close').click(function() {
      closeErrorMessage();
    });
  };

  function closeErrorMessage() {
    var errorMessage = $('.message');
    if(!errorMessage.hasClass('hidden')) {
      errorMessage.transition('fade');
    }
  }

  var callFindLowestMastery = function(event, template) {
    closeErrorMessage();
    Session.set('loading', true);
    Meteor.call('findLowestMasteries', template.$('.summoner-name').val(), function(err, data) {
      if(!err) {
        Masteries.remove({});
        Masteries.batchInsert(data);
      }
      else if(err.error == 'no-summoner' || err.error == 'no-champions-played') {
        $('.message #error-message-text').text(err.reason);
        $('.message').removeClass('hidden');
      }
      else {
        console.log(err.error);
      }
        alert(`Error occurred. Status code: ${err.statsCode}, Error body: ${err}`);

      Session.set('loading', false);
    });
  };

  Template.search.events({
    'keypress input': function (event, template) {
      if (event.keyCode == 13) {
        // increment the counter when button is clicked
        callFindLowestMastery(event, template);
      }
    },
    'click i': callFindLowestMastery
  });
}

Meteor.methods({
  updateChampions: (override) => {
    var updated = ChampionsUpdated.findOne({});
    if (updated == null || override === true) {
      updated = {};
    }
    else if(moment(updated.updatedAt).isAfter(moment().subtract(1, 'd'))) {
      console.log(`Champions already updated at ${moment(updated.updatedAt).format('DD/MM/YY LT')}`);
      return;
    }

    Champions.remove({});
    var response = HTTP.get('https://global.api.pvp.net/api/lol/static-data/oce/v1.2/champion',
        { params: {
            api_key: league_api_key,
            champData: 'image,tags' }
        });
    var champs = JSON.parse(response.content).data;

    Champions.batchInsert(Object.keys(champs).map(key => champs[key]));
    updated.updatedAt = new Date();
    ChampionsUpdated.upsert({}, updated);

    console.log('Champions have been updated');
  },
  findLowestMasteries: summonerName => {
    if (Meteor.isServer) {
      try {
        var summonerInfo = HTTP.get(`https://oce.api.pvp.net/api/lol/oce/v1.4/summoner/by-name/${summonerName}`,
          { params: {
            api_key: league_api_key
          }});

        summonerInfo = JSON.parse(summonerInfo.content);
      } catch(err) {
        if (err.response.statusCode == 404) {
          throw new Meteor.Error('no-summoner', `Couldn't find the summoner name ${summonerName} on oce`);
        }
      }

      var summonerId = summonerInfo[Object.keys(summonerInfo)[0]].id;

      var masteryInfo = HTTP.get(`https://oce.api.pvp.net/championmastery/location/OC1/player/${summonerId}/champions`,
        { params: {
            api_key: league_api_key
        }});

      masteryInfo = JSON.parse(masteryInfo.content);

      Masteries.remove({});
      Masteries.batchInsert(masteryInfo);
      if (Masteries.find({ championPoints: { $gt: 0 }}).count() == 0) {
        throw new Meteor.Error('no-champions-played', `The summoner ${summonerName} exists, but hasn't played any champions`);
      }

      for(var i in masteryInfo) {
        masteryInfo[i].champInfo = Champions.findOne({ id: masteryInfo[i].championId});
      }

      return masteryInfo;
    }
  }
});

if (Meteor.isServer) {
  Meteor.startup(function () {
    // code to run on server at startup
    Meteor.publish('champions', function() {
      return Champions.find({});
    });

    Meteor.call('updateChampions');
  });
}
